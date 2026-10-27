import { ConnectorCore } from "../core/connector-core.js";
import { IpcServer } from "../ipc/ipc-server.js";
import { ConnectorClient } from "../connection/client.js";
import { Metrics } from "../observability/metrics.js";
import { log } from "../observability/logger.js";

export class ConnectorServiceRuntime {
  private readonly core: ConnectorCore;
  private readonly ipc: IpcServer;
  private readonly client: ConnectorClient;
  private startedAt?: string;
  private readonly metrics = new Metrics();

  constructor(pairingCode?: string) {
    const allowedRoots = (process.env.CONNECTOR_ALLOWED_ROOTS ?? process.cwd()).split(",").map((value) => value.trim()).filter(Boolean);
    const permissions = (process.env.CONNECTOR_PERMISSIONS ?? "connector.health,model.discovery").split(",").map((value) => value.trim()).filter(Boolean) as import("../../../../packages/protocol/src/index.js").Permission[];
    const allowedTerminalCommands = (process.env.CONNECTOR_TERMINAL_COMMANDS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    this.core = new ConnectorCore({ allowedRoots, permissions, allowedTerminalCommands });
    this.client = new ConnectorClient({ serverUrl: process.env.CONNECTOR_SERVER_URL ?? "ws://127.0.0.1:4100/connect", pairingCode, core: this.core });
    this.ipc = new IpcServer({ core: this.core, getStatus: () => ({ ready: Boolean(this.startedAt), startedAt: this.startedAt, connected: this.client.isConnected(), capabilities: this.core.getCapabilities(), metrics: this.metrics.snapshot() }) });
  }

  async start(): Promise<void> {
    this.startedAt = new Date().toISOString();
    this.metrics.increment("service.start");
    log("info", "service.starting", { startedAt: this.startedAt });
    await this.ipc.start();
    await this.client.start();
    log("info", "service.started", { connected: this.client.isConnected() });
  }

  async stop(): Promise<void> {
    this.metrics.increment("service.stop");
    log("info", "service.stopping");
    this.client.stop();
    await this.ipc.stop();
    log("info", "service.stopped");
  }
}
