export type ConnectorStatus = {
  ready: boolean;
  connected: boolean;
  connectorId?: string;
  startedAt?: string;
  capabilities: string[];
  permissions?: string[];
  diagnostics?: Record<string, unknown>;
  metrics?: { uptimeSeconds?: number; counters?: Record<string, number> };
};

export type PairingSession = { pairingId: string; pairingCode: string; expiresAt: string; qrPayload: string };

export type ConnectorBridge = {
  getStatus(): Promise<ConnectorStatus>;
  getCapabilities(): Promise<string[]>;
  getPermissions(): Promise<string[]>;
  updatePermissions(permissions: string[]): Promise<string[]>;
  diagnostics(): Promise<Record<string, unknown>>;
  startService(pairingCode?: string): Promise<{ ok: boolean; message?: string }>;
  stopService(): Promise<{ ok: boolean; message?: string }>;
  restartService(): Promise<{ ok: boolean; message?: string }>;
  rotateToken(): Promise<{ ok: boolean; tokenExpiresAt?: string; message?: string }>;
  execute(operation: string, input?: Record<string, unknown>): Promise<Record<string, unknown>>;
  createPairingSession(): Promise<PairingSession>;
  pair(pairingCode: string): Promise<{ ok: boolean; message?: string }>;
  revoke(): Promise<{ ok: boolean; message?: string }>;
};

type NativeBridge = Partial<ConnectorBridge>;

function nativeBridge(): NativeBridge | undefined {
  return (globalThis as typeof globalThis & { goldenAgent?: NativeBridge }).goldenAgent;
}

function runningInTauri(): boolean {
  return Boolean((globalThis as typeof globalThis & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

function backendUrl(): string { return (globalThis as typeof globalThis & { GOLDEN_AGENT_BACKEND_URL?: string }).GOLDEN_AGENT_BACKEND_URL ?? "http://127.0.0.1:4100"; }

const developmentStatus: ConnectorStatus = {
  ready: true,
  connected: true,
  startedAt: new Date(Date.now() - 86_000).toISOString(),
  capabilities: ["connector.health", "models.discover", "models.stream", "browser.open", "browser.screenshot"],
  metrics: { uptimeSeconds: 86, counters: { "service.start": 1 } },
};

export const connectorApi: ConnectorBridge = {
  async getStatus() { return runningInTauri() ? await invoke<ConnectorStatus>("connector_status") : nativeBridge()?.getStatus?.() ?? developmentStatus; },
  async getCapabilities() { return runningInTauri() ? await invoke<string[]>("connector_capabilities") : nativeBridge()?.getCapabilities?.() ?? developmentStatus.capabilities; },
  async getPermissions() { return runningInTauri() ? await invoke<string[]>("connector_permissions") : developmentStatus.permissions ?? ["connector.health"]; },
  async updatePermissions(permissions) { return runningInTauri() ? await invoke<string[]>("connector_update_permissions", { permissions }) : permissions; },
  async diagnostics() { return runningInTauri() ? await invoke<Record<string, unknown>>("connector_diagnostics") : await this.getStatus() as Record<string, unknown>; },
  async startService(pairingCode) { return runningInTauri() ? await invoke<{ ok: boolean; message?: string }>("connector_start", { pairingCode }) : { ok: true, message: "Development service start accepted." }; },
  async stopService() { return runningInTauri() ? await invoke<{ ok: boolean; message?: string }>("connector_stop") : { ok: true, message: "Development service stop accepted." }; },
  async restartService() { return runningInTauri() ? await invoke<{ ok: boolean; message?: string }>("connector_restart") : { ok: true, message: "Development service restart accepted." }; },
  async rotateToken() {
    const current = await this.getStatus();
    if (!current.connectorId) return { ok: false, message: "Connector identity is unavailable." };
    const response = await fetch(`${backendUrl()}/v1/connectors/${encodeURIComponent(current.connectorId)}/rotate-token`, { method: "POST" });
    const body = await response.json() as { ok: boolean; tokenExpiresAt?: string };
    return response.ok ? body : { ok: false, message: "Token rotation failed." };
  },
  async execute(operation, input = {}) { return runningInTauri() ? await invoke<Record<string, unknown>>("connector_execute", { operation, input }) : await nativeBridge()?.execute?.(operation, input) ?? { ok: true, operation, input }; },
  async createPairingSession() {
    const response = await fetch(`${backendUrl()}/v1/connectors/pairing`, { method: "POST" });
    if (!response.ok) throw new Error(`Unable to create pairing session (HTTP ${response.status})`);
    return await response.json() as PairingSession;
  },
  async pair(pairingCode) {
    if (!pairingCode.trim()) return { ok: false, message: "Enter the pairing code from the connector." };
    if (runningInTauri()) return await invoke<{ ok: boolean; message?: string }>("connector_pair", { pairingCode });
    return nativeBridge()?.pair?.(pairingCode) ?? { ok: true, message: "Development bridge accepted the pairing code." };
  },
  async revoke() {
    const current = await this.getStatus();
    if (!current.connectorId) return nativeBridge()?.revoke?.() ?? { ok: false, message: "Connector identity is unavailable." };
    const response = await fetch(`${backendUrl()}/v1/connectors/${encodeURIComponent(current.connectorId)}/revoke`, { method: "POST" });
    return response.ok ? await response.json() as { ok: boolean; message?: string } : { ok: false, message: "Connector revocation failed." };
  },
};
import { invoke } from "@tauri-apps/api/core";
