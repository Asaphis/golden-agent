import WebSocket from "ws";
import type { BackendMessage, HeartbeatMessage, OperationRequest, PairingRequest } from "../../../../packages/protocol/src/index.js";
import { loadOrCreateIdentity, saveAccessToken } from "../identity/identity.js";
import type { ConnectorCore } from "../core/connector-core.js";

export interface ConnectorClientOptions {
  serverUrl: string;
  pairingCode?: string;
  once?: boolean;
  core?: ConnectorCore;
}

export class ConnectorClient {
  private socket?: WebSocket;
  private authenticated = false;
  private heartbeatTimer?: NodeJS.Timeout;
  private connected = false;
  private readonly identity = loadOrCreateIdentity();

  constructor(private readonly options: ConnectorClientOptions) {}

  isConnected(): boolean { return this.connected; }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new WebSocket(this.options.serverUrl);
      this.socket.once("error", reject);
      this.socket.on("open", () => {
        this.connected = true;
        if (this.options.pairingCode) {
          const request: PairingRequest = { type: "pairing.request", pairingCode: this.options.pairingCode, connectorId: this.identity.connectorId, deviceName: this.identity.deviceName, platform: this.identity.platform };
          this.socket?.send(JSON.stringify(request));
        } else {
          reject(new Error("A pairing code is required for this initial connector flow"));
        }
      });
      this.socket.on("message", (raw) => this.handleMessage(String(raw), resolve, reject));
      this.socket.on("close", () => {
        this.connected = false;
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      });
    });
  }

  private handleMessage(raw: string, resolve: () => void, reject: (error: Error) => void): void {
    const message = JSON.parse(raw) as BackendMessage;
    if (message.type === "pairing.accepted") {
      saveAccessToken(message.accessToken);
      this.socket?.send(JSON.stringify({ type: "authenticate", connectorId: message.connectorId, accessToken: message.accessToken }));
      this.authenticated = true;
      this.sendHeartbeat();
      this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), 5000);
      console.log(`Connector paired: ${message.connectorId}`);
      console.log(`Granted permissions: ${message.permissions.join(", ")}`);
      resolve();
      return;
    }
    if (message.type === "operation.request") this.handleOperation(message);
    void reject;
  }

  private sendHeartbeat(): void {
    if (!this.authenticated || !this.socket) return;
    const heartbeat: HeartbeatMessage = { type: "heartbeat", connectorId: this.identity.connectorId, timestamp: new Date().toISOString(), capabilities: ["connector.health"] };
    this.socket.send(JSON.stringify(heartbeat));
  }

  private handleOperation(request: OperationRequest): void {
    if (!this.authenticated) return;
    const result = this.options.core
      ? this.options.core.execute(request.operation, request.input).then((value) => this.sendResult(request.requestId, true, value)).catch((error) => this.sendResult(request.requestId, false, undefined, error instanceof Error ? error.message : String(error)))
      : Promise.resolve(this.sendResult(request.requestId, true, { connectorId: this.identity.connectorId, platform: this.identity.platform, nodeVersion: process.version, checkedAt: new Date().toISOString() }));
    void result;
  }

  private sendResult(requestId: string, ok: boolean, result?: Record<string, unknown>, error?: string): void {
    this.socket?.send(JSON.stringify({ type: "operation.result", requestId, ok, result, error: error ? { code: "OPERATION_FAILED", message: error } : undefined }));
  }

  stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.socket?.close();
  }
}
