import os from "node:os";
import { readdir } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Permission } from "../../../../packages/protocol/src/index.js";

const execFileAsync = promisify(execFile);

export interface CoreOptions {
  allowedRoots?: string[];
  permissions?: Permission[];
}

export class ConnectorCore {
  private readonly allowedRoots: string[];
  private readonly permissions: Set<Permission>;

  constructor(options: CoreOptions = {}) {
    this.allowedRoots = (options.allowedRoots ?? [process.cwd()]).map((root) => resolve(root));
    this.permissions = new Set(options.permissions ?? ["connector.health"]);
  }

  getCapabilities(): string[] {
    return ["connector.health", "system.info", "models.discover", "filesystem.list", "git.status"];
  }

  hasPermission(permission: Permission): boolean {
    return this.permissions.has(permission);
  }

  async execute(operation: string, input: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (operation === "health.check") {
      this.require("connector.health");
      return { healthy: true, checkedAt: new Date().toISOString(), capabilities: this.getCapabilities() };
    }
    if (operation === "system.info") {
      this.require("connector.health");
      return { platform: process.platform, arch: process.arch, hostname: os.hostname(), nodeVersion: process.version, uptimeSeconds: os.uptime() };
    }
    if (operation === "models.discover") {
      this.require("model.discovery");
      return { models: await this.discoverModels() };
    }
    if (operation === "filesystem.list") {
      this.require("filesystem.read");
      const path = this.safePath(String(input.path ?? this.allowedRoots[0]));
      return { path, entries: await readdir(path, { withFileTypes: true }).then((items) => items.map((item) => ({ name: item.name, type: item.isDirectory() ? "directory" : "file" }))) };
    }
    if (operation === "git.status") {
      this.require("git.read");
      const path = this.safePath(String(input.path ?? this.allowedRoots[0]));
      const result = await execFileAsync("git", ["-C", path, "status", "--short", "--branch"], { timeout: 10_000 });
      return { path, output: result.stdout };
    }
    throw new Error(`Unsupported operation: ${operation}`);
  }

  private require(permission: Permission): void {
    if (!this.permissions.has(permission)) throw new Error(`Permission denied: ${permission}`);
  }

  private safePath(inputPath: string): string {
    const candidate = resolve(inputPath);
    if (!isAbsolute(candidate)) throw new Error("Path must be absolute");
    const allowed = this.allowedRoots.some((root) => {
      const rel = relative(root, candidate);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    });
    if (!allowed) throw new Error("Path is outside the connector allowed roots");
    return candidate;
  }

  private async discoverModels(): Promise<Array<Record<string, unknown>>> {
    try {
      const response = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(1500) });
      if (!response.ok) return [];
      const body = await response.json() as { models?: Array<Record<string, unknown>> };
      return (body.models ?? []).map((model) => ({ id: model.name, provider: "ollama", capabilities: ["text"] }));
    } catch {
      return [];
    }
  }
}
