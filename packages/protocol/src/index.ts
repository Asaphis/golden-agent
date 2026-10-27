export type Permission = "connector.health" | "model.discovery" | "model.use" | "filesystem.read" | "filesystem.write" | "terminal.execute" | "git.read" | "git.write" | "browser.use" | "process.manage" | "testing.execute" | "building.execute";

export type ConnectorStatus = "pending" | "online" | "offline" | "revoked";

export interface PairingRequest {
  type: "pairing.request";
  pairingCode: string;
  connectorId: string;
  deviceName: string;
  platform: string;
}

export interface PairingAccepted {
  type: "pairing.accepted";
  connectorId: string;
  deviceId: string;
  accessToken: string;
  permissions: Permission[];
}

export interface HeartbeatMessage {
  type: "heartbeat";
  connectorId: string;
  timestamp: string;
  capabilities: string[];
}

export interface AuthenticateMessage {
  type: "authenticate";
  connectorId: string;
  accessToken: string;
}

export interface OperationRequest {
  type: "operation.request";
  requestId: string;
  operation: "health.check" | "system.info" | "models.discover" | "models.execute" | "filesystem.list" | "filesystem.read" | "filesystem.write" | "git.status" | "process.list" | "terminal.execute";
  input?: Record<string, unknown>;
}

export interface OperationResult {
  type: "operation.result";
  requestId: string;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
}

export type ConnectorMessage = PairingRequest | AuthenticateMessage | HeartbeatMessage | OperationResult;
export type BackendMessage = PairingAccepted | OperationRequest;
