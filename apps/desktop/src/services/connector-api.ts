export type ConnectorStatus = {
  ready: boolean;
  connected: boolean;
  startedAt?: string;
  capabilities: string[];
  metrics?: { uptimeSeconds?: number; counters?: Record<string, number> };
};

export type ConnectorBridge = {
  getStatus(): Promise<ConnectorStatus>;
  getCapabilities(): Promise<string[]>;
  execute(operation: string, input?: Record<string, unknown>): Promise<Record<string, unknown>>;
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
  async execute(operation, input = {}) { return runningInTauri() ? await invoke<Record<string, unknown>>("connector_execute", { operation, input }) : { ok: true, operation, input }; },
  async pair(pairingCode) {
    if (!pairingCode.trim()) return { ok: false, message: "Enter the pairing code from the connector." };
    if (runningInTauri()) return await invoke<{ ok: boolean; message?: string }>("connector_pair", { pairingCode });
    return nativeBridge()?.pair?.(pairingCode) ?? { ok: true, message: "Development bridge accepted the pairing code." };
  },
  async revoke() { return runningInTauri() ? await invoke<{ ok: boolean; message?: string }>("connector_revoke") : nativeBridge()?.revoke?.() ?? { ok: true, message: "Development bridge revoked the connector." }; },
};
import { invoke } from "@tauri-apps/api/core";
