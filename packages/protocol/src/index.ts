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
  tokenExpiresAt: string;
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

export interface PermissionsUpdateMessage {
  type: "permissions.update";
  connectorId: string;
  permissions: Permission[];
}

export interface TokenRotatedMessage {
  type: "token.rotated";
  connectorId: string;
  accessToken: string;
  tokenExpiresAt: string;
}

export interface PermissionsAcknowledgedMessage {
  type: "permissions.acknowledged";
  connectorId: string;
  permissions: Permission[];
}

export interface OperationRequest {
  type: "operation.request";
  requestId: string;
  operation: "health.check" | "system.info" | "models.discover" | "models.execute" | "models.stream" | "filesystem.list" | "filesystem.read" | "filesystem.write" | "git.status" | "process.list" | "process.start" | "process.stop" | "terminal.execute" | "testing.run" | "building.run" | "artifact.collect";
  input?: Record<string, unknown>;
  taskId?: string;
  timeoutMs?: number;
}

export interface OperationResult {
  type: "operation.result";
  requestId: string;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
  taskId?: string;
}

export interface TaskProgressMessage {
  type: "task.progress";
  taskId: string;
  progress: number;
  message?: string;
}

export interface TaskCancelMessage {
  type: "task.cancel";
  taskId: string;
}

export type ConnectorMessage = PairingRequest | AuthenticateMessage | HeartbeatMessage | OperationResult | TaskProgressMessage | PermissionsAcknowledgedMessage;
export type BackendMessage = PairingAccepted | PermissionsUpdateMessage | TokenRotatedMessage | OperationRequest | TaskCancelMessage;
