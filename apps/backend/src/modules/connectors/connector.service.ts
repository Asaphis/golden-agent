import { randomBytes, randomUUID } from "node:crypto";
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
    this.database.createConnector({
      connectorId: request.connectorId,
      deviceId,
      deviceName: request.deviceName,
      platform: request.platform,
      status: "pending",
      accessToken,
      permissions: DEFAULT_PERMISSIONS,
      lastSeenAt: null,
    });
    this.database.addAudit("connector.paired", request.connectorId, { deviceId, platform: request.platform });
    return { type: "pairing.accepted", connectorId: request.connectorId, deviceId, accessToken, permissions: DEFAULT_PERMISSIONS };
  }

  authenticate(connectorId: string, accessToken: string): boolean {
    const record = this.database.getConnector(connectorId);
    return Boolean(record && record.status !== "revoked" && record.accessToken === accessToken);
  }

  heartbeat(message: HeartbeatMessage): void {
    this.database.updateHeartbeat(message.connectorId, message.timestamp);
    this.database.addAudit("connector.heartbeat", message.connectorId, { capabilities: message.capabilities });
  }

  requestHealthCheck(connectorId: string, socket: WebSocket): string | null {
    const record = this.database.getConnector(connectorId);
    if (!record || !record.permissions.includes("connector.health") || record.status === "revoked") return null;
    const requestId = randomUUID();
    const message: OperationRequest = { type: "operation.request", requestId, operation: "health.check" };
    socket.send(JSON.stringify(message));
    this.database.addAudit("operation.requested", connectorId, { requestId, operation: message.operation });
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

  getConnector(connectorId: string) {
    return this.database.getConnector(connectorId);
  }
}
