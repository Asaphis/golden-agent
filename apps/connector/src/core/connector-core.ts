import os from "node:os";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Permission } from "../../../../packages/protocol/src/index.js";

const execFileAsync = promisify(execFile);

export interface CoreOptions {
  allowedRoots?: string[];
  permissions?: Permission[];
  allowedTerminalCommands?: string[];
}

export class ConnectorCore {
  private readonly allowedRoots: string[];
  private readonly permissions: Set<Permission>;
  private readonly allowedTerminalCommands: Set<string>;

  constructor(options: CoreOptions = {}) {
    this.allowedRoots = (options.allowedRoots ?? [process.cwd()]).map((root) => resolve(root));
    this.permissions = new Set(options.permissions ?? ["connector.health"]);
    this.allowedTerminalCommands = new Set(options.allowedTerminalCommands ?? []);
  }

  getCapabilities(): string[] {
    return [
      "connector.health", "system.info", "models.discover", "models.execute",
      "filesystem.list", "filesystem.read", "filesystem.write", "git.status",
      "process.list", "terminal.execute",
    ];
  }

  hasPermission(permission: Permission): boolean { return this.permissions.has(permission); }

  updatePermissions(permissions: Permission[]): void {
    this.permissions.clear();
    for (const permission of permissions) this.permissions.add(permission);
  }

  async execute(operation: string, input: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (operation === "health.check") {
      this.require("connector.health");
      const delayMs = Math.min(Math.max(Number(input.delayMs ?? 0), 0), 60_000);
      if (delayMs) await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
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
    if (operation === "models.execute") {
      this.require("model.use");
      return await this.executeModel(String(input.model ?? ""), String(input.prompt ?? ""));
    }
    if (operation === "filesystem.list") {
      this.require("filesystem.read");
      const path = this.safePath(String(input.path ?? this.allowedRoots[0]));
      return { path, entries: (await readdir(path, { withFileTypes: true })).map((item) => ({ name: item.name, type: item.isDirectory() ? "directory" : "file" })) };
    }
    if (operation === "filesystem.read") {
      this.require("filesystem.read");
      const path = this.safePath(String(input.path));
      const maxBytes = Math.min(Number(input.maxBytes ?? 1_000_000), 5_000_000);
      const content = await readFile(path, "utf8");
      return { path, content: content.slice(0, maxBytes), truncated: content.length > maxBytes };
    }
    if (operation === "filesystem.write") {
      this.require("filesystem.write");
      const path = this.safePath(String(input.path));
      const content = String(input.content ?? "");
      if (content.length > 5_000_000) throw new Error("File content exceeds the connector limit");
      await writeFile(path, content, "utf8");
      return { path, bytesWritten: Buffer.byteLength(content), writtenAt: new Date().toISOString() };
    }
    if (operation === "git.status") {
      this.require("git.read");
      const path = this.safePath(String(input.path ?? this.allowedRoots[0]));
      const result = await execFileAsync("git", ["-C", path, "status", "--short", "--branch"], { timeout: 10_000 });
      return { path, output: result.stdout };
    }
    if (operation === "process.list") {
      this.require("process.manage");
      return { processes: process.platform === "win32" ? await this.command("tasklist", [], 10_000) : await this.command("ps", ["-eo", "pid,comm,args"], 10_000) };
    }
    if (operation === "terminal.execute") {
      this.require("terminal.execute");
      const command = String(input.command ?? "");
      const args = Array.isArray(input.args) ? input.args.map(String) : [];
      if (!this.allowedTerminalCommands.has(command)) throw new Error(`Terminal command is not allowlisted: ${command}`);
      return await this.command(command, args, Math.min(Number(input.timeoutMs ?? 10_000), 60_000));
    }
    throw new Error(`Unsupported operation: ${operation}`);
  }

  private async command(command: string, args: string[], timeout: number): Promise<Record<string, unknown>> {
    const result = await execFileAsync(command, args, { timeout, maxBuffer: 2_000_000 });
    return { command, args, stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
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
    } catch { return []; }
  }

  private async executeModel(model: string, prompt: string): Promise<Record<string, unknown>> {
    if (!model || !prompt) throw new Error("Model and prompt are required");
    const response = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`Local model runtime returned HTTP ${response.status}`);
    const body = await response.json() as Record<string, unknown>;
    return { model, provider: "ollama", response: body.response ?? body };
  }
}
