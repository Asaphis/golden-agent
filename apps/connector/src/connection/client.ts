import WebSocket from "ws";
import type { AuthenticateMessage, BackendMessage, HeartbeatMessage, OperationRequest, PairingRequest, PermissionsUpdateMessage, TaskCancelMessage, TaskProgressMessage, TokenRotatedMessage } from "../../../../packages/protocol/src/index.js";
import { loadOrCreateIdentity, loadAccessToken, saveAccessToken } from "../identity/identity.js";
import type { ConnectorCore } from "../core/connector-core.js";

export interface ConnectorClientOptions {
  serverUrl: string;
  pairingCode?: string;
  core?: ConnectorCore;
  reconnect?: boolean;
}

export class ConnectorClient {
  private socket?: WebSocket;
  private authenticated = false;
  private connected = false;
  private stopping = false;
  private heartbeatTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempt = 0;
  private readonly cancelledTasks = new Set<string>();
  private firstConnectionResolved = false;
  private readonly identity = loadOrCreateIdentity();

  constructor(private readonly options: ConnectorClientOptions) {}

  isConnected(): boolean { return this.connected && this.authenticated; }

  getConnectorId(): string { return this.identity.connectorId; }

  start(): Promise<void> {
    this.stopping = false;
    return new Promise((resolve, reject) => {
      this.connect(resolve, reject);
    });
  }

  private connect(resolve: () => void, reject: (error: Error) => void): void {
    if (this.stopping) return;
    this.socket = new WebSocket(this.options.serverUrl);
    let opened = false;
    this.socket.once("error", (error) => {
      if (!this.firstConnectionResolved) reject(error instanceof Error ? error : new Error("Connector WebSocket error"));
    });
    this.socket.on("open", () => {
      opened = true;
      this.connected = true;
      this.reconnectAttempt = 0;
      const accessToken = loadAccessToken();
      if (this.options.pairingCode) {
        const request: PairingRequest = { type: "pairing.request", pairingCode: this.options.pairingCode, connectorId: this.identity.connectorId, deviceName: this.identity.deviceName, platform: this.identity.platform };
        this.socket?.send(JSON.stringify(request));
      } else if (accessToken) {
        const request: AuthenticateMessage = { type: "authenticate", connectorId: this.identity.connectorId, accessToken };
        this.socket?.send(JSON.stringify(request));
        this.authenticated = true;
        this.startHeartbeat();
        if (!this.firstConnectionResolved) { this.firstConnectionResolved = true; resolve(); }
      } else if (!this.firstConnectionResolved) {
        reject(new Error("No connector credentials. Pair this connector first."));
      }
    });
    this.socket.on("message", (raw) => this.handleMessage(String(raw), resolve));
    this.socket.on("close", () => {
      this.connected = false;
      this.authenticated = false;
      this.stopHeartbeat();
      if (!this.stopping && (this.options.reconnect ?? true) && loadAccessToken()) this.scheduleReconnect();
      if (!opened && !this.firstConnectionResolved) reject(new Error("Connector connection closed before authentication"));
    });
  }

  private handleMessage(raw: string, resolve: () => void): void {
    const message = JSON.parse(raw) as BackendMessage;
    if (message.type === "pairing.accepted") {
      saveAccessToken(message.accessToken);
      this.options.pairingCode = undefined;
      this.socket?.send(JSON.stringify({ type: "authenticate", connectorId: message.connectorId, accessToken: message.accessToken } satisfies AuthenticateMessage));
      this.authenticated = true;
      this.startHeartbeat();
      console.log(`Connector paired: ${message.connectorId}`);
      console.log(`Granted permissions: ${message.permissions.join(", ")}`);
      if (!this.firstConnectionResolved) { this.firstConnectionResolved = true; resolve(); }
      return;
    }
    if (message.type === "permissions.update") {
      const update = message as PermissionsUpdateMessage;
      if (update.connectorId === this.identity.connectorId) {
        this.options.core?.updatePermissions(update.permissions);
        if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: "permissions.acknowledged", connectorId: update.connectorId, permissions: update.permissions }));
      }
      return;
    }
    if (message.type === "task.cancel") {
      this.cancelledTasks.add((message as TaskCancelMessage).taskId);
      return;
    }
    if (message.type === "token.rotated") {
      const rotation = message as TokenRotatedMessage;
      if (rotation.connectorId === this.identity.connectorId) saveAccessToken(rotation.accessToken);
      return;
    }
    if (message.type === "operation.request") this.handleOperation(message);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.sendHeartbeat();
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), 5000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private sendHeartbeat(): void {
    if (!this.isConnected() || !this.socket) return;
    const heartbeat: HeartbeatMessage = { type: "heartbeat", connectorId: this.identity.connectorId, timestamp: new Date().toISOString(), capabilities: this.options.core?.getCapabilities() ?? ["connector.health"] };
    this.socket.send(JSON.stringify(heartbeat));
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(30_000, 1_000 * (2 ** this.reconnectAttempt));
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect(() => undefined, () => this.scheduleReconnect());
    }, delay);
  }

  private handleOperation(request: OperationRequest): void {
    if (!this.authenticated) return;
    const taskId = request.taskId;
    if (taskId) this.sendProgress(taskId, 10, "Started");
    const work = this.options.core
      ? this.options.core.execute(request.operation, request.input)
      : Promise.resolve({ connectorId: this.identity.connectorId, platform: process.platform, nodeVersion: process.version, checkedAt: new Date().toISOString() });
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Connector operation timeout")), request.timeoutMs ?? 30_000));
    const operation = Promise.race([work, timeout]).then((value) => {
      if (taskId && this.cancelledTasks.has(taskId)) { this.cancelledTasks.delete(taskId); return; }
      if (taskId) this.sendProgress(taskId, 90, "Execution complete");
      this.sendResult(request.requestId, true, value, undefined, taskId);
    }).catch((error) => {
      if (taskId && this.cancelledTasks.has(taskId)) { this.cancelledTasks.delete(taskId); return; }
      this.sendResult(request.requestId, false, undefined, error instanceof Error ? error.message : String(error), taskId);
    });
    void operation;
  }

  private sendProgress(taskId: string, progress: number, message: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const event: TaskProgressMessage = { type: "task.progress", taskId, progress, message };
    this.socket.send(JSON.stringify(event));
  }

  private sendResult(requestId: string, ok: boolean, result?: Record<string, unknown>, error?: string, taskId?: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "operation.result", requestId, taskId, ok, result, error: error ? { code: "OPERATION_FAILED", message: error } : undefined }));
  }

  stop(): void {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.stopHeartbeat();
    if (this.socket && this.socket.readyState === WebSocket.OPEN) this.socket.close();
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) this.socket.terminate();
  }
}
