import { createServer, type Server } from "node:net";
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import type { ConnectorCore } from "../core/connector-core.js";

export interface IpcServerOptions { socketPath?: string; core: ConnectorCore; getStatus: () => Record<string, unknown>; }

export class IpcServer {
  private readonly socketPath: string;
  private server?: Server;

  constructor(private readonly options: IpcServerOptions) { this.socketPath = resolve(options.socketPath ?? "./.data/connector/connector.sock"); }

  start(): Promise<void> {
    return new Promise((resolveStart, reject) => {
      if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
      this.server = createServer((socket) => {
        let body = "";
        let responded = false;
        const respond = (payload: Record<string, unknown>) => {
          if (responded || socket.destroyed) return;
          responded = true;
          socket.write(JSON.stringify(payload));
          socket.end();
        };
        socket.on("error", () => undefined);
        const handleRequest = async () => {
          if (responded) return;
          try {
            const request = JSON.parse(body.trim()) as { action?: string; operation?: string; input?: Record<string, unknown> };
            if (request.action === "status") respond({ ok: true, status: this.options.getStatus() });
            else if (request.action === "capabilities") respond({ ok: true, capabilities: this.options.core.getCapabilities() });
            else if (request.action === "execute" && request.operation) respond({ ok: true, result: await this.options.core.execute(request.operation, request.input) });
            else respond({ ok: false, error: "INVALID_IPC_REQUEST" });
          } catch (error) { respond({ ok: false, error: error instanceof Error ? error.message : "IPC_ERROR" }); }
        };
        socket.on("data", (chunk) => { body += String(chunk); if (body.includes("\n")) void handleRequest(); });
        socket.on("end", () => { if (body.trim()) void handleRequest(); });
      });
      this.server.once("error", reject);
      this.server.listen(this.socketPath, () => { chmodSync(this.socketPath, 0o600); resolveStart(); });
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolveStop) => this.server?.close(() => resolveStop()) ?? resolveStop());
    if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
  }
}
