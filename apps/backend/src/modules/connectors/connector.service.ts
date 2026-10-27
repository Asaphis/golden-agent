import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { HeartbeatMessage, OperationRequest, OperationResult, PairingAccepted, PairingRequest, Permission } from "../../../../../packages/protocol/src/index.js";
import { Database } from "../../database/database.js";

const DEFAULT_PERMISSIONS: Permission[] = ["connector.health"];

export class ConnectorService {
  constructor(private readonly database: Database) {}

  createPairing(): { pairingId: string; pairingCode: string; expiresAt: string } {
    const pairingId = randomUUID();
    const pairingCode = `GLA-${randomBytes(2).toString("hex").toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    this.database.createPairing(pairingId, pairingCode, expiresAt);
    this.database.addAudit("pairing.created", null, { pairingId, expiresAt });
    return { pairingId, pairingCode, expiresAt };
  }

  pair(request: PairingRequest, _socket: WebSocket): PairingAccepted | null {
    if (!this.database.consumePairing(request.pairingCode)) return null;
    const deviceId = randomUUID();
    const accessToken = randomBytes(32).toString("hex");
    const accessTokenHash = createHash("sha256").update(accessToken).digest("hex");
    this.database.createConnector({
      connectorId: request.connectorId,
      deviceId,
      deviceName: request.deviceName,
      platform: request.platform,
      status: "pending",
      accessToken: accessTokenHash,
      permissions: DEFAULT_PERMISSIONS,
      lastSeenAt: null,
    });
    this.database.addAudit("connector.paired", request.connectorId, { deviceId, platform: request.platform });
    return { type: "pairing.accepted", connectorId: request.connectorId, deviceId, accessToken, permissions: DEFAULT_PERMISSIONS };
  }

  authenticate(connectorId: string, accessToken: string): boolean {
    const record = this.database.getConnector(connectorId);
    const accessTokenHash = createHash("sha256").update(accessToken).digest("hex");
    return Boolean(record && record.status !== "revoked" && record.accessToken === accessTokenHash);
  }

  heartbeat(message: HeartbeatMessage): void {
    this.database.updateHeartbeat(message.connectorId, message.timestamp);
    this.database.addAudit("connector.heartbeat", message.connectorId, { capabilities: message.capabilities });
  }

  requestHealthCheck(connectorId: string, socket: WebSocket): string | null {
    return this.requestOperation(connectorId, socket, "health.check");
  }

  requestOperation(connectorId: string, socket: WebSocket, operation: OperationRequest["operation"], input?: Record<string, unknown>): string | null {
    const record = this.database.getConnector(connectorId);
    const requiredPermission: Permission = operation === "models.discover" ? "model.discovery"
      : operation === "models.execute" ? "model.use"
      : operation === "filesystem.list" || operation === "filesystem.read" ? "filesystem.read"
      : operation === "filesystem.write" ? "filesystem.write"
      : operation === "git.status" ? "git.read"
      : operation === "process.list" ? "process.manage"
      : operation === "terminal.execute" ? "terminal.execute"
      : "connector.health";
    if (!record || !record.permissions.includes(requiredPermission) || record.status === "revoked") return null;
    const requestId = randomUUID();
    const message: OperationRequest = { type: "operation.request", requestId, operation, input };
    socket.send(JSON.stringify(message));
    this.database.addAudit("operation.requested", connectorId, { requestId, operation, requiredPermission });
    return requestId;
  }

  recordOperationResult(result: OperationResult, connectorId: string): void {
    this.database.addAudit("operation.result", connectorId, { requestId: result.requestId, ok: result.ok, result: result.result, error: result.error });
  }

  revoke(connectorId: string): boolean {
    const changed = this.database.revokeConnector(connectorId);
    if (changed) this.database.addAudit("connector.revoked", connectorId, {});
    return changed;
  }

  updatePermissions(connectorId: string, permissions: Permission[]): boolean {
    const changed = this.database.updatePermissions(connectorId, permissions);
    if (changed) this.database.addAudit("connector.permissions.updated", connectorId, { permissions });
    return changed;
  }

  getConnector(connectorId: string) {
    return this.database.getConnector(connectorId);
  }
}
