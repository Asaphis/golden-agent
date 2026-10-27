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
  pair(pairingCode: string): Promise<{ ok: boolean; message?: string }>;
  revoke(): Promise<{ ok: boolean; message?: string }>;
};

type NativeBridge = Partial<ConnectorBridge>;

function nativeBridge(): NativeBridge | undefined {
  return (globalThis as typeof globalThis & { goldenAgent?: NativeBridge }).goldenAgent;
}

const developmentStatus: ConnectorStatus = {
  ready: true,
  connected: true,
  startedAt: new Date(Date.now() - 86_000).toISOString(),
  capabilities: ["connector.health", "models.discover", "models.stream", "browser.open", "browser.screenshot"],
  metrics: { uptimeSeconds: 86, counters: { "service.start": 1 } },
};

export const connectorApi: ConnectorBridge = {
  async getStatus() { return nativeBridge()?.getStatus?.() ?? developmentStatus; },
  async getCapabilities() { return nativeBridge()?.getCapabilities?.() ?? developmentStatus.capabilities; },
  async pair(pairingCode) {
    if (!pairingCode.trim()) return { ok: false, message: "Enter the pairing code from the connector." };
    return nativeBridge()?.pair?.(pairingCode) ?? { ok: true, message: "Development bridge accepted the pairing code." };
  },
  async revoke() { return nativeBridge()?.revoke?.() ?? { ok: true, message: "Development bridge revoked the connector." }; },
};
