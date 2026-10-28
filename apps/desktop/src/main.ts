import "./styles.css";
import QRCode from "qrcode";
import { connectorApi, type ConnectorStatus, type PairingSession } from "./services/connector-api.js";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Desktop app root is missing");
const root = app;

type Section = "overview" | "permissions" | "models" | "capabilities" | "logs";
type ModelItem = { id: string; provider?: string; capabilities?: string[] };
let status: ConnectorStatus | null = null;
let capabilities: string[] = [];
let message = "";
let pairingSession: PairingSession | null = null;
let section: Section = "overview";
let healthResult = "";
let models: ModelItem[] = [];
let selectedModel = "";
let modelPrompt = "";
let modelResult = "";
let modelBusy = false;
const ALL_PERMISSIONS = ["connector.health", "model.discovery", "model.use", "filesystem.read", "filesystem.write", "terminal.execute", "git.read", "git.write", "browser.use", "process.manage", "testing.execute", "building.execute"];

function escapeHtml(value: string): string { return value.replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character); }
function badge(value: string, tone: "green" | "amber" | "slate" = "slate"): string { return `<span class="badge ${tone}">${escapeHtml(value)}</span>`; }
function formatUptime(seconds: number): string { if (!seconds) return "—"; const minutes = Math.floor(seconds / 60); return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`; }

function renderPairing(): void {
  root.innerHTML = `<div class="setup-shell"><div class="setup-card">
    <div class="brand setup-brand"><div class="brand-mark">G</div><div><strong>Golden Agent</strong><small>Desktop connector</small></div></div>
    <div class="setup-icon">⌁</div><p class="eyebrow">FIRST-TIME SETUP</p><h1>Connect this computer</h1>
    <p class="muted setup-copy">Pair this desktop with Golden Agent using the one-time code shown by the connector service. Your dashboard will appear after the connection is verified.</p>
    ${message ? `<div class="notice">${escapeHtml(message)}</div>` : ""}
    ${pairingSession ? `<div class="pairing-session"><canvas id="pairing-qr" width="220" height="220"></canvas><div class="pairing-details"><span class="eyebrow">PAIRING CODE</span><strong>${escapeHtml(pairingSession.pairingCode)}</strong><span class="muted">Expires ${new Date(pairingSession.expiresAt).toLocaleTimeString()}</span></div></div>` : `<button class="secondary setup-generate" id="generate-pairing" type="button">Generate QR pairing code</button>`}
    <form id="pair-form" class="setup-form"><label for="pairing-code">Pairing code</label><input id="pairing-code" placeholder="GLA-XXXX-XXXX" autocomplete="off" autofocus><button class="primary" type="submit">Pair device</button></form>
    <div class="setup-help"><strong>Running headless?</strong><span>Start the connector from SSH or Termux, then enter its pairing code here.</span></div><p class="setup-foot">The connector remains local and permission-controlled.</p>
  </div></div>`;
  wireEvents();
  if (pairingSession) { const canvas = document.querySelector<HTMLCanvasElement>("#pairing-qr"); if (canvas) void QRCode.toCanvas(canvas, pairingSession.qrPayload, { width: 220, margin: 2 }); }
}

function renderOverview(): string {
  const connected = Boolean(status?.connected);
  return `<header class="topbar"><div><p class="eyebrow">LOCAL DEVICE</p><h1>Connector manager</h1></div><div class="top-actions">${badge(connected ? "Online" : "Offline", connected ? "green" : "amber")}<button class="icon-button" id="refresh" title="Refresh status">↻</button></div></header>
  ${message ? `<div class="notice">${escapeHtml(message)}</div>` : ""}
  <section class="hero-card"><div><p class="eyebrow">DEVICE CONNECTION</p><h2>Your connector is ready</h2><p class="muted">The desktop manager communicates with the background connector through authenticated local IPC.</p></div><div class="hero-status">${badge("Connected to Golden Agent", "green")}<small>${status?.startedAt ? `Running since ${new Date(status.startedAt).toLocaleTimeString()}` : "Service is running"}</small></div></section>
  <div class="grid"><section class="card"><div class="card-heading"><div><p class="eyebrow">SERVICE</p><h3>Runtime health</h3></div><span class="card-icon">♥</span></div><div class="metric-list"><div><span>Status</span><strong>Healthy</strong></div><div><span>Uptime</span><strong>${formatUptime(status?.metrics?.uptimeSeconds ?? 0)}</strong></div><div><span>Capabilities</span><strong>${capabilities.length}</strong></div></div></section><section class="card"><div class="card-heading"><div><p class="eyebrow">ACCESS</p><h3>Permissions</h3></div><span class="card-icon">✓</span></div><div class="chips">${(status?.permissions ?? []).map((permission) => `<span class="chip">${escapeHtml(permission)}</span>`).join("") || `<span class="muted">No permissions reported.</span>`}</div></section></div>`;
}

function renderSection(): string {
  if (section === "overview") return renderOverview();
  if (section === "permissions") return `<header class="topbar"><div><p class="eyebrow">ACCESS CONTROL</p><h1>Permissions</h1></div><button class="icon-button" id="refresh" title="Refresh permissions">↻</button></header><section class="card"><div class="card-heading"><div><p class="eyebrow">ENFORCED LOCALLY</p><h3>Connector permissions</h3></div>${badge("Authenticated", "green")}</div><p class="muted">Changes are validated and applied by the connector before local operations can run.</p><div class="permission-list">${ALL_PERMISSIONS.map((permission) => `<label class="permission-row permission-check"><span>${escapeHtml(permission)}</span><input type="checkbox" data-permission="${permission}" ${status?.permissions?.includes(permission) ? "checked" : ""}></label>`).join("")}</div><button class="primary" id="save-permissions">Save permissions</button></section>`;
  if (section === "models") return `<header class="topbar"><div><p class="eyebrow">LOCAL MODEL RUNTIME</p><h1>Models</h1></div><button class="icon-button" id="refresh-models" title="Discover local models">↻</button></header><section class="card"><div class="card-heading"><div><p class="eyebrow">OLLAMA</p><h3>Available models</h3></div>${badge(`${models.length} discovered`, models.length ? "green" : "amber")}</div><p class="muted">Models are discovered through the connector. Prompts never bypass the model-use permission.</p>${models.length ? `<div class="model-list">${models.map((model) => `<button class="model-row ${selectedModel === model.id ? "selected" : ""}" data-model="${escapeHtml(model.id)}"><span><strong>${escapeHtml(model.id)}</strong><small>${escapeHtml(model.provider ?? "local provider")}</small></span>${badge((model.capabilities ?? ["text"]).join(", "), "slate")}</button>`).join("")}</div><label for="model-prompt">Prompt</label><textarea id="model-prompt" rows="5" placeholder="Ask the selected local model…">${escapeHtml(modelPrompt)}</textarea><button class="primary" id="run-model" ${modelBusy || !selectedModel ? "disabled" : ""}>${modelBusy ? "Running…" : "Run model"}</button>${modelResult ? `<pre class="result-box">${escapeHtml(modelResult)}</pre>` : ""}` : `<div class="empty-state"><strong>No local models discovered</strong><span>Start Ollama and grant model discovery permission, then refresh.</span></div>`}</section>`;
  if (section === "capabilities") return `<header class="topbar"><div><p class="eyebrow">LOCAL ACCESS</p><h1>Capabilities</h1></div><button class="icon-button" id="refresh" title="Refresh capabilities">↻</button></header><section class="card"><div class="card-heading"><div><p class="eyebrow">DISCOVERED FROM IPC</p><h3>Available connector operations</h3></div>${badge(`${capabilities.length} available`, "green")}</div><div class="capability-list">${capabilities.map((capability) => `<div class="permission-row"><span>${escapeHtml(capability)}</span>${badge("Available", "slate")}</div>`).join("") || `<div class="muted">No capabilities reported.</div>`}</div><button class="primary" id="run-health">Run connector health check</button>${healthResult ? `<pre class="result-box">${escapeHtml(healthResult)}</pre>` : ""}</section>`;
  return `<header class="topbar"><div><p class="eyebrow">OPERATIONS</p><h1>Service & logs</h1></div><button class="icon-button" id="refresh" title="Refresh service status">↻</button></header><section class="card"><div class="card-heading"><div><p class="eyebrow">RUNTIME</p><h3>Connector service</h3></div>${badge(status?.ready ? "Running" : "Stopped", status?.ready ? "green" : "amber")}</div><div class="metric-list"><div><span>Connection</span><strong>${status?.connected ? "Authenticated" : "Offline"}</strong></div><div><span>Started</span><strong>${status?.startedAt ? new Date(status.startedAt).toLocaleString() : "—"}</strong></div><div><span>Uptime</span><strong>${formatUptime(status?.metrics?.uptimeSeconds ?? 0)}</strong></div></div><button class="primary" id="run-health">Run health check</button>${healthResult ? `<pre class="result-box">${escapeHtml(healthResult)}</pre>` : ""}</section>`;
}

function render(): void {
  if (!status?.connected) { renderPairing(); return; }
  root.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><div class="brand-mark">G</div><div><strong>Golden Agent</strong><small>Desktop manager</small></div></div><nav>${(["overview", "permissions", "models", "capabilities", "logs"] as Section[]).map((item) => `<button class="nav-item ${section === item ? "active" : ""}" data-section="${item}">${item === "logs" ? "Service & logs" : item[0].toUpperCase() + item.slice(1)}</button>`).join("")}</nav><div class="sidebar-foot">Connector runtime<br><span>Authenticated local bridge</span></div></aside><main class="content">${message ? `<div class="notice">${escapeHtml(message)}</div>` : ""}${renderSection()}${section === "overview" ? `<section class="danger-zone"><div><p class="eyebrow">DANGER ZONE</p><h3>Disconnect this device</h3><p class="muted">Revoking removes this connector’s access token. You can pair it again later.</p></div><button class="danger" id="revoke">Revoke connector</button></section>` : ""}</main></div>`;
  wireEvents();
}

async function load(): Promise<void> {
  try { status = await connectorApi.getStatus(); capabilities = await connectorApi.getCapabilities(); if (status.permissions?.includes("model.discovery")) { const discovered = await connectorApi.execute("models.discover"); models = Array.isArray(discovered.models) ? discovered.models as ModelItem[] : []; if (!selectedModel && models[0]) selectedModel = models[0].id; } message = ""; }
  catch (error) { status = { ready: false, connected: false, capabilities: [], permissions: [], metrics: { uptimeSeconds: 0 } }; capabilities = []; message = `Connector is offline. Start or pair the connector service to enable local access.${error instanceof Error ? ` (${error.message})` : ""}`; }
  render();
}

function wireEvents(): void {
  document.querySelector("#generate-pairing")?.addEventListener("click", async () => { message = "Creating a secure pairing session…"; render(); try { pairingSession = await connectorApi.createPairingSession(); message = "Scan the QR code or enter the pairing code on the connector."; } catch (error) { pairingSession = null; message = error instanceof Error ? error.message : "Unable to create a pairing session."; } render(); });
  document.querySelector("#refresh")?.addEventListener("click", () => void load());
  document.querySelector("#run-health")?.addEventListener("click", async () => { healthResult = "Running…"; render(); try { healthResult = JSON.stringify(await connectorApi.execute("health.check"), null, 2); } catch (error) { healthResult = error instanceof Error ? error.message : String(error); } render(); });
  document.querySelector("#refresh-models")?.addEventListener("click", async () => { try { const discovered = await connectorApi.execute("models.discover"); models = Array.isArray(discovered.models) ? discovered.models as ModelItem[] : []; if (!selectedModel && models[0]) selectedModel = models[0].id; message = `${models.length} local model${models.length === 1 ? "" : "s"} discovered.`; } catch (error) { message = error instanceof Error ? error.message : "Model discovery failed."; } render(); });
  document.querySelectorAll<HTMLButtonElement>("[data-model]").forEach((button) => button.addEventListener("click", () => { selectedModel = button.dataset.model ?? ""; render(); }));
  document.querySelector<HTMLTextAreaElement>("#model-prompt")?.addEventListener("input", (event) => { modelPrompt = (event.target as HTMLTextAreaElement).value; });
  document.querySelector("#run-model")?.addEventListener("click", async () => { if (!selectedModel || !modelPrompt.trim()) { message = "Select a model and enter a prompt first."; render(); return; } modelBusy = true; modelResult = ""; render(); try { const result = await connectorApi.execute("models.stream", { model: selectedModel, prompt: modelPrompt }); modelResult = String(result.response ?? JSON.stringify(result, null, 2)); } catch (error) { modelResult = error instanceof Error ? error.message : String(error); } finally { modelBusy = false; render(); } });
  document.querySelector("#save-permissions")?.addEventListener("click", async () => { const permissions = [...document.querySelectorAll<HTMLInputElement>("[data-permission]:checked")].map((input) => input.dataset.permission ?? ""); try { status = { ...(status as ConnectorStatus), permissions: await connectorApi.updatePermissions(permissions) }; message = "Permissions saved and enforced by the connector."; } catch (error) { message = error instanceof Error ? error.message : "Unable to update permissions."; } render(); });
  document.querySelector("#revoke")?.addEventListener("click", async () => { const result = await connectorApi.revoke(); message = result.message ?? (result.ok ? "Connector revoked." : "Unable to revoke connector."); await load(); });
  document.querySelector<HTMLFormElement>("#pair-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const code = document.querySelector<HTMLInputElement>("#pairing-code")?.value ?? ""; const result = await connectorApi.pair(code); message = result.message ?? (result.ok ? "Pairing completed." : "Pairing failed."); await load(); });
  document.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((button) => button.addEventListener("click", () => { section = button.dataset.section as Section; message = ""; render(); }));
}

render();
void load();
