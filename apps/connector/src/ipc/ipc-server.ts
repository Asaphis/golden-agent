import { createServer, type Server } from "node:net";
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { ConnectorCore } from "../core/connector-core.js";
import { loadOrCreateIpcSecret } from "./ipc-auth.js";
import type { Permission } from "../../../../packages/protocol/src/index.js";

const VALID_PERMISSIONS = new Set<Permission>([
  "connector.health", "model.discovery", "model.use", "filesystem.read", "filesystem.write",
  "terminal.execute", "git.read", "git.write", "browser.use", "process.manage", "testing.execute", "building.execute",
]);

export interface IpcServerOptions { socketPath?: string; host?: string; port?: number; transport?: "auto" | "unix" | "tcp"; core: ConnectorCore; getStatus: () => Record<string, unknown>; }

export class IpcServer {
  private readonly socketPath: string;
  private readonly host: string;
  private readonly port: number;
  private readonly useTcp: boolean;
  private server?: Server;
  private readonly secret = loadOrCreateIpcSecret();
  private readonly usedNonces = new Set<string>();

  constructor(private readonly options: IpcServerOptions) {
    this.useTcp = options.transport === "tcp" || (options.transport !== "unix" && process.platform === "win32");
    this.socketPath = this.useTcp ? "" : resolve(options.socketPath ?? "./.data/connector/connector.sock");
    this.host = options.host ?? process.env.CONNECTOR_IPC_HOST ?? "127.0.0.1";
    this.port = options.port ?? Number(process.env.CONNECTOR_IPC_PORT ?? 4101);
  }

  start(): Promise<void> {
    return new Promise((resolveStart, reject) => {
      if (this.socketPath && existsSync(this.socketPath)) unlinkSync(this.socketPath);
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
            if (Buffer.byteLength(body, "utf8") > 1_000_000) return respond({ ok: false, error: "IPC_REQUEST_TOO_LARGE" });
            const request = JSON.parse(body.trim()) as { auth?: string; nonce?: string; action?: string; operation?: string; input?: Record<string, unknown> };
            if (request.auth !== this.secret) return respond({ ok: false, error: "IPC_AUTHENTICATION_FAILED" });
            if (!request.nonce || this.usedNonces.has(request.nonce)) return respond({ ok: false, error: "IPC_REPLAY_DETECTED" });
            this.usedNonces.add(request.nonce);
            if (this.usedNonces.size > 10_000) this.usedNonces.clear();
            if (request.action === "status") respond({ ok: true, status: this.options.getStatus() });
            else if (request.action === "capabilities") respond({ ok: true, capabilities: this.options.core.getCapabilities() });
            else if (request.action === "permissions") respond({ ok: true, permissions: this.options.core.getPermissions() });
            else if (request.action === "update_permissions") {
              const permissions = Array.isArray(request.input?.permissions) ? request.input.permissions.map(String) : [];
              if (permissions.some((permission) => !VALID_PERMISSIONS.has(permission as Permission))) return respond({ ok: false, error: "INVALID_PERMISSION" });
              this.options.core.updatePermissions(permissions as Permission[]);
              respond({ ok: true, permissions: this.options.core.getPermissions() });
            }
            else if (request.action === "execute" && request.operation) respond({ ok: true, result: await this.options.core.execute(request.operation, request.input) });
            else respond({ ok: false, error: "INVALID_IPC_REQUEST" });
          } catch (error) { respond({ ok: false, error: error instanceof Error ? error.message : "IPC_ERROR" }); }
        };
        socket.on("data", (chunk) => { body += String(chunk); if (body.includes("\n")) void handleRequest(); });
        socket.on("end", () => { if (body.trim()) void handleRequest(); });
      });
      this.server.once("error", reject);
      if (this.socketPath) this.server.listen(this.socketPath, () => { chmodSync(this.socketPath, 0o600); resolveStart(); });
      else this.server.listen(this.port, this.host, resolveStart);
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolveStop) => this.server?.close(() => resolveStop()) ?? resolveStop());
    if (this.socketPath && existsSync(this.socketPath)) unlinkSync(this.socketPath);
  }
}
