import "./styles.css";
import { connectorApi, type ConnectorStatus } from "./services/connector-api.js";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Desktop app root is missing");
const root = app;

let status: ConnectorStatus | null = null;
let capabilities: string[] = [];
let message = "";

function escapeHtml(value: string): string { return value.replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character); }
function badge(value: string, tone: "green" | "amber" | "slate" = "slate"): string { return `<span class="badge ${tone}">${escapeHtml(value)}</span>`; }

function render(): void {
  const connected = Boolean(status?.connected);
  root.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><div class="brand-mark">G</div><div><strong>Golden Agent</strong><small>Desktop manager</small></div></div>
        <nav><button class="nav-item active" data-section="overview">Overview</button><button class="nav-item" data-section="permissions">Permissions</button><button class="nav-item" data-section="capabilities">Capabilities</button><button class="nav-item" data-section="logs">Service & logs</button></nav>
        <div class="sidebar-foot">Connector runtime<br><span>Phase 8 desktop foundation</span></div>
      </aside>
      <main class="content">
        <header class="topbar"><div><p class="eyebrow">LOCAL DEVICE</p><h1>Connector manager</h1></div><div class="top-actions">${badge(connected ? "Online" : "Offline", connected ? "green" : "amber")}<button class="icon-button" id="refresh" title="Refresh status">↻</button></div></header>
        ${message ? `<div class="notice">${escapeHtml(message)}</div>` : ""}
        <section class="hero-card"><div><p class="eyebrow">DEVICE CONNECTION</p><h2>${connected ? "Your connector is ready" : "Connector needs attention"}</h2><p class="muted">The desktop manager communicates with the background connector through authenticated local IPC.</p></div><div class="hero-status">${badge(connected ? "Connected to Golden Agent" : "Disconnected", connected ? "green" : "amber")}<small>${status?.startedAt ? `Running since ${new Date(status.startedAt).toLocaleTimeString()}` : "Service is not running"}</small></div></section>
        <div class="grid">
          <section class="card"><div class="card-heading"><div><p class="eyebrow">PAIRING</p><h3>Connect this device</h3></div><span class="card-icon">⌁</span></div><p class="muted">Enter the one-time code shown by the connector service to pair this computer.</p><form id="pair-form"><label for="pairing-code">Pairing code</label><div class="input-row"><input id="pairing-code" placeholder="GLA-XXXX-XXXX" autocomplete="off"><button class="primary" type="submit">Pair device</button></div></form></section>
          <section class="card"><div class="card-heading"><div><p class="eyebrow">SERVICE</p><h3>Runtime health</h3></div><span class="card-icon">♥</span></div><div class="metric-list"><div><span>Status</span><strong>${connected ? "Healthy" : "Offline"}</strong></div><div><span>Uptime</span><strong>${formatUptime(status?.metrics?.uptimeSeconds ?? 0)}</strong></div><div><span>Capabilities</span><strong>${capabilities.length}</strong></div></div></section>
        </div>
        <section class="card capabilities-card"><div class="card-heading"><div><p class="eyebrow">ACCESS</p><h3>Available capabilities</h3></div><button class="text-button" id="view-capabilities">View all</button></div><div class="chips">${capabilities.slice(0, 8).map((capability) => `<span class="chip">${escapeHtml(capability)}</span>`).join("") || `<span class="muted">No capabilities reported.</span>`}</div></section>
        <section class="danger-zone"><div><p class="eyebrow">DANGER ZONE</p><h3>Disconnect this device</h3><p class="muted">Revoking removes this connector’s access token. You can pair it again later.</p></div><button class="danger" id="revoke">Revoke connector</button></section>
      </main>
    </div>`;
  wireEvents();
}

function formatUptime(seconds: number): string { if (!seconds) return "—"; const minutes = Math.floor(seconds / 60); return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`; }
async function load(): Promise<void> { status = await connectorApi.getStatus(); capabilities = await connectorApi.getCapabilities(); render(); }
function wireEvents(): void {
  document.querySelector("#refresh")?.addEventListener("click", () => void load());
  document.querySelector("#view-capabilities")?.addEventListener("click", () => { message = `${capabilities.length} capabilities available through the connector.`; render(); });
  document.querySelector("#revoke")?.addEventListener("click", async () => { const result = await connectorApi.revoke(); message = result.message ?? (result.ok ? "Connector revoked." : "Unable to revoke connector."); await load(); });
  document.querySelector<HTMLFormElement>("#pair-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const code = document.querySelector<HTMLInputElement>("#pairing-code")?.value ?? ""; const result = await connectorApi.pair(code); message = result.message ?? (result.ok ? "Pairing completed." : "Pairing failed."); await load(); });
  document.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((button) => button.addEventListener("click", () => { message = `${button.textContent} view is ready for the next desktop milestone.`; render(); }));
}

void load();
