import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createPairingCode } from "./pairing/pairing-client.js";
import { sendIpc } from "./ipc/ipc-client.js";

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const values = args.filter((value) => value !== "--json");
const command = values[0] ?? "help";
const rest = values.slice(1);

function flag(name: string, fallback = ""): string {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] ?? fallback : fallback;
}
function output(value: unknown, human?: string): void { if (jsonMode) console.log(JSON.stringify(value, null, 2)); else console.log(human ?? (typeof value === "string" ? value : JSON.stringify(value, null, 2))); }
function fail(error: unknown): never { if (jsonMode) console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })); else console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }
async function ipc(request: Record<string, unknown>): Promise<Record<string, unknown>> { const result = await sendIpc(request); if (result.ok === false) throw new Error(String(result.error ?? "Connector request failed")); return result; }
async function execute(operation: string, input: Record<string, unknown> = {}): Promise<Record<string, unknown>> { const result = await ipc({ action: "execute", operation, input }); return result.result as Record<string, unknown> ?? result; }
function pidFile(): string { return process.env.CONNECTOR_PID_PATH ?? join(process.env.XDG_RUNTIME_DIR ?? join(homedir(), ".golden-agent"), "connector.pid"); }

async function main(): Promise<void> {
  if (command === "help" || command === "--help") { output({ commands: ["pair", "status", "doctor", "permissions list|set", "models list|run", "browser open|navigate|inspect|screenshot|click|type|close", "resources list|read|write", "process list", "terminal run", "git status", "logs", "service start|stop|restart"] }, "Golden Agent Connector CLI\n\nCommands: pair, status, doctor, permissions, models, browser, resources, process, terminal, git, logs, service\nAdd --json for machine-readable output."); return; }
  if (command === "pair") { await createPairingCode(); return; }
  if (command === "status") { const result = await ipc({ action: "status" }); output(result, `Connector: ${result.status && (result.status as Record<string, unknown>).connected ? "connected" : "offline"}\n${JSON.stringify(result.status, null, 2)}`); return; }
  if (command === "doctor") { const result = await ipc({ action: "diagnostics" }); output(result, "Connector diagnostics\n" + JSON.stringify(result.diagnostics, null, 2)); return; }
  if (command === "capabilities") { output(await ipc({ action: "capabilities" })); return; }
  if (command === "permissions") { const action = rest[0] ?? "list"; if (action === "list") { output(await ipc({ action: "permissions" })); return; } if (action === "set") { const permissions = (flag("--permissions") || rest.slice(1).join(",")).split(",").map((item) => item.trim()).filter(Boolean); output(await ipc({ action: "update_permissions", input: { permissions } })); return; } }
  if (command === "models") { const action = rest[0] ?? "list"; if (action === "list") { output(await execute("models.discover")); return; } if (action === "run") { output(await execute("models.stream", { model: flag("--model"), prompt: flag("--prompt") })); return; } }
  if (command === "resources") { const action = rest[0] ?? "list"; const path = flag("--path", "."); if (action === "list") output(await execute("filesystem.list", { path })); else if (action === "read") output(await execute("filesystem.read", { path })); else if (action === "write") output(await execute("filesystem.write", { path, content: flag("--content") })); else throw new Error("Use resources list, read, or write"); return; }
  if (command === "process" && rest[0] === "list") { output(await execute("process.list")); return; }
  if (command === "terminal" && rest[0] === "run") { const commandName = flag("--command", rest[1] ?? ""); const commandArgs = flag("--args").split(/\s+/).filter(Boolean); output(await execute("terminal.execute", { command: commandName, args: commandArgs })); return; }
  if (command === "git" && rest[0] === "status") { output(await execute("git.status", { path: flag("--path", ".") })); return; }
  if (command === "browser") { const action = rest[0] ?? "open"; const sessionId = flag("--session"); const input: Record<string, unknown> = { sessionId }; if (action === "open") output(await execute("browser.open")); else if (action === "navigate") output(await execute("browser.navigate", { ...input, url: flag("--url") })); else if (action === "inspect") output(await execute("browser.inspect", input)); else if (action === "screenshot") output(await execute("browser.screenshot", input)); else if (action === "click") output(await execute("browser.click", { ...input, selector: flag("--selector") })); else if (action === "type") output(await execute("browser.type", { ...input, selector: flag("--selector"), text: flag("--text") })); else if (action === "close") output(await execute("browser.close", input)); else throw new Error("Unknown browser action"); return; }
  if (command === "logs") { const path = process.env.CONNECTOR_LOG_PATH ?? join(process.env.CONNECTOR_DATA_PATH ?? ".data/connector", "connector.log"); output({ path, exists: existsSync(path), content: existsSync(path) ? readFileSync(path, "utf8") : "No connector log file found." }); return; }
  if (command === "service") { const action = rest[0] ?? "start"; const file = pidFile(); if (action === "status") { const pid = existsSync(file) ? Number(readFileSync(file, "utf8")) : undefined; let running = false; if (pid) { try { process.kill(pid, 0); running = true; } catch {} } output({ ok: true, running, pid }, `Connector service: ${running ? `running (PID ${pid})` : "stopped"}`); return; } if (action === "start" || action === "restart") { if (action === "restart" && existsSync(file)) { try { process.kill(Number(readFileSync(file, "utf8"))); } catch {} unlinkSync(file); } const child = spawn(process.execPath, [process.argv[1], "start", ...((flag("--pairing-code")) ? ["--pairing-code", flag("--pairing-code")] : [])], { detached: true, stdio: "ignore" }); writeFileSync(file, String(child.pid)); child.unref(); output({ ok: true, pid: child.pid }, `Connector service started (PID ${child.pid}).`); return; } if (action === "stop") { if (!existsSync(file)) { output({ ok: true, stopped: false }, "No CLI-managed connector process found."); return; } const pid = Number(readFileSync(file, "utf8")); try { process.kill(pid); } catch {} unlinkSync(file); output({ ok: true, stopped: true }, `Connector service stopped (PID ${pid}).`); return; } }
  throw new Error(`Unknown command: ${command}. Run golden-agent-connector help.`);
}

main().catch(fail);
