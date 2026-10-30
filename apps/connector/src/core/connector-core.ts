import os from "node:os";
import { readFile, writeFile, readdir, realpath, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import type { Permission } from "../../../../packages/protocol/src/index.js";
import type { ModelAdapter } from "../models/model-adapter.js";
import { OllamaAdapter } from "../models/ollama-adapter.js";
import { BrowserManager } from "../browser/browser-manager.js";

const execFileAsync = promisify(execFile);

export interface CoreOptions {
  allowedRoots?: string[];
  permissions?: Permission[];
  allowedTerminalCommands?: string[];
  modelAdapter?: ModelAdapter;
  browserManager?: BrowserManager;
}

export class ConnectorCore {
  private readonly allowedRoots: string[];
  private readonly permissions: Set<Permission>;
  private readonly allowedTerminalCommands: Set<string>;
  private readonly managedProcesses = new Map<number, ChildProcess>();
  private readonly modelAdapter: ModelAdapter;
  private readonly browserManager: BrowserManager;

  constructor(options: CoreOptions = {}) {
    this.allowedRoots = (options.allowedRoots ?? [process.cwd()]).map((root) => resolve(root));
    this.permissions = new Set(options.permissions ?? ["connector.health"]);
    this.allowedTerminalCommands = new Set(options.allowedTerminalCommands ?? []);
    this.modelAdapter = options.modelAdapter ?? new OllamaAdapter();
    this.browserManager = options.browserManager ?? new BrowserManager();
  }

  getCapabilities(): string[] {
    const capabilities = [
      "connector.health", "system.info", "models.discover", "models.execute", "models.stream",
      "filesystem.list", "filesystem.read", "filesystem.write", "git.status",
      "process.list", "process.start", "process.stop", "terminal.execute", "testing.run", "building.run", "artifact.collect", "browser.open", "browser.navigate", "browser.inspect", "browser.screenshot", "browser.click", "browser.type", "browser.close",
    ];
    if (process.platform === "android") return capabilities.filter((capability) => !capability.startsWith("browser."));
    return capabilities;
  }

  async dispose(): Promise<void> {
    for (const child of this.managedProcesses.values()) child.kill("SIGTERM");
    this.managedProcesses.clear();
    await this.browserManager.closeAll();
  }

  hasPermission(permission: Permission): boolean { return this.permissions.has(permission); }

  getPermissions(): Permission[] { return [...this.permissions]; }

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
      return { models: await this.modelAdapter.discover() };
    }
    if (operation === "models.execute") {
      this.require("model.use");
      return { ...(await this.modelAdapter.execute({ model: String(input.model ?? ""), prompt: String(input.prompt ?? ""), timeoutMs: Number(input.timeoutMs ?? 120_000) })) };
    }
    if (operation === "models.stream") {
      this.require("model.use");
      const chunks: string[] = [];
      for await (const chunk of this.modelAdapter.stream({ model: String(input.model ?? ""), prompt: String(input.prompt ?? ""), timeoutMs: Number(input.timeoutMs ?? 120_000) })) chunks.push(chunk);
      return { model: String(input.model ?? ""), provider: this.modelAdapter.provider, chunks, response: chunks.join("") };
    }
    if (operation === "browser.open") {
      this.require("browser.use");
      return await this.browserManager.open();
    }
    if (operation === "browser.navigate") {
      this.require("browser.use");
      return { ...(await this.browserManager.navigate(String(input.sessionId), String(input.url), Number(input.timeoutMs ?? 30_000))) };
    }
    if (operation === "browser.inspect") {
      this.require("browser.use");
      return { ...(await this.browserManager.inspect(String(input.sessionId))) };
    }
    if (operation === "browser.screenshot") {
      this.require("browser.use");
      return await this.browserManager.screenshot(String(input.sessionId));
    }
    if (operation === "browser.click") {
      this.require("browser.use");
      return await this.browserManager.click(String(input.sessionId), String(input.selector));
    }
    if (operation === "browser.type") {
      this.require("browser.use");
      return await this.browserManager.type(String(input.sessionId), String(input.selector), String(input.text ?? ""));
    }
    if (operation === "browser.close") {
      this.require("browser.use");
      return await this.browserManager.close(String(input.sessionId));
    }
    if (operation === "filesystem.list") {
      this.require("filesystem.read");
      const path = await this.safePath(String(input.path ?? this.allowedRoots[0]));
      return { path, entries: (await readdir(path, { withFileTypes: true })).map((item) => ({ name: item.name, type: item.isDirectory() ? "directory" : "file" })) };
    }
    if (operation === "filesystem.read") {
      this.require("filesystem.read");
      const path = await this.safePath(String(input.path));
      const maxBytes = Math.min(Number(input.maxBytes ?? 1_000_000), 5_000_000);
      const content = await readFile(path, "utf8");
      return { path, content: content.slice(0, maxBytes), truncated: content.length > maxBytes };
    }
    if (operation === "filesystem.write") {
      this.require("filesystem.write");
      const path = await this.safePath(String(input.path));
      const content = String(input.content ?? "");
      if (content.length > 5_000_000) throw new Error("File content exceeds the connector limit");
      await writeFile(path, content, "utf8");
      return { path, bytesWritten: Buffer.byteLength(content), writtenAt: new Date().toISOString() };
    }
    if (operation === "git.status") {
      this.require("git.read");
      const path = await this.safePath(String(input.path ?? this.allowedRoots[0]));
      const result = await execFileAsync("git", ["-C", path, "status", "--short", "--branch"], { timeout: 10_000 });
      return { path, output: result.stdout };
    }
    if (operation === "process.list") {
      this.require("process.manage");
      return { processes: process.platform === "win32" ? await this.command("tasklist", [], 10_000) : await this.command("ps", ["-eo", "pid,comm,args"], 10_000) };
    }
    if (operation === "process.start") {
      this.require("process.manage");
      const command = String(input.command ?? "");
      const args = Array.isArray(input.args) ? input.args.map(String) : [];
      if (!this.allowedTerminalCommands.has(command)) throw new Error(`Process command is not allowlisted: ${command}`);
      const child = spawn(command, args, { stdio: "ignore", env: { PATH: process.env.PATH ?? "", LANG: "C", LC_ALL: "C", TMPDIR: process.env.TMPDIR ?? "/tmp" } });
      if (!child.pid) throw new Error("Process failed to start");
      this.managedProcesses.set(child.pid, child);
      child.once("exit", () => this.managedProcesses.delete(child.pid!));
      return { pid: child.pid, command, args, startedAt: new Date().toISOString() };
    }
    if (operation === "process.stop") {
      this.require("process.manage");
      const pid = Number(input.pid);
      const child = this.managedProcesses.get(pid);
      if (!child) throw new Error("Process is not managed by this connector");
      child.kill("SIGTERM");
      this.managedProcesses.delete(pid);
      return { pid, stopped: true, stoppedAt: new Date().toISOString() };
    }
    if (operation === "testing.run" || operation === "building.run") {
      this.require(operation === "testing.run" ? "testing.execute" : "building.execute");
      const cwd = await this.safePath(String(input.path ?? this.allowedRoots[0]));
      return await this.command("pnpm", [operation === "testing.run" ? "test" : "build"], Math.min(Number(input.timeoutMs ?? 120_000), 300_000), cwd);
    }
    if (operation === "artifact.collect") {
      this.require("filesystem.read");
      const root = await this.safePath(String(input.path ?? this.allowedRoots[0]));
      return { root, artifacts: await this.collectArtifacts(root) };
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

  private async command(command: string, args: string[], timeout: number, cwd?: string): Promise<Record<string, unknown>> {
    const result = await execFileAsync(command, args, { timeout, cwd, maxBuffer: 2_000_000, env: { PATH: process.env.PATH ?? "", LANG: "C", LC_ALL: "C", TMPDIR: process.env.TMPDIR ?? "/tmp" } });
    return { command, args, stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  }

  private async collectArtifacts(root: string): Promise<Array<Record<string, unknown>>> {
    const results: Array<Record<string, unknown>> = [];
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) await visit(path);
        else { const details = await stat(path); results.push({ path, size: details.size, modifiedAt: details.mtime.toISOString() }); }
        if (results.length >= 10_000) return;
      }
    };
    await visit(root);
    return results;
  }

  private require(permission: Permission): void {
    if (!this.permissions.has(permission)) throw new Error(`Permission denied: ${permission}`);
  }

  private async safePath(inputPath: string): Promise<string> {
    const candidate = resolve(inputPath);
    if (!isAbsolute(candidate)) throw new Error("Path must be absolute");
    const allowed = this.allowedRoots.some((root) => {
      const rel = relative(root, candidate);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    });
    if (!allowed) throw new Error("Path is outside the connector allowed roots");
    try {
      const canonical = await realpath(candidate);
      if (!this.isAllowed(canonical)) throw new Error("Path resolves outside the connector allowed roots");
      return canonical;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = await realpath(resolve(candidate, ".."));
      if (!this.isAllowed(parent)) throw new Error("Path parent resolves outside the connector allowed roots");
      return candidate;
    }
  }

  private isAllowed(candidate: string): boolean {
    return this.allowedRoots.some((root) => {
      const rel = relative(root, candidate);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    });
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
