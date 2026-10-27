import { ConnectorCore } from "../core/connector-core.js";
import { IpcServer } from "../ipc/ipc-server.js";
import { ConnectorClient } from "../connection/client.js";

export class ConnectorServiceRuntime {
  private readonly core: ConnectorCore;
  private readonly ipc: IpcServer;
  private readonly client: ConnectorClient;
  private startedAt?: string;

  constructor(pairingCode?: string) {
    this.core = new ConnectorCore({ allowedRoots: [process.cwd()], permissions: ["connector.health", "model.discovery"] });
    this.client = new ConnectorClient({ serverUrl: process.env.CONNECTOR_SERVER_URL ?? "ws://127.0.0.1:4100/connect", pairingCode, core: this.core });
    this.ipc = new IpcServer({ core: this.core, getStatus: () => ({ startedAt: this.startedAt, connected: this.client.isConnected(), capabilities: this.core.getCapabilities() }) });
  }

  async start(): Promise<void> {
    this.startedAt = new Date().toISOString();
    await this.ipc.start();
    await this.client.start();
  }

  async stop(): Promise<void> {
    this.client.stop();
    await this.ipc.stop();
  }
}
