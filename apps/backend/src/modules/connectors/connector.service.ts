import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { HeartbeatMessage, OperationRequest, OperationResult, PairingAccepted, PairingRequest, Permission, TaskProgressMessage } from "../../../../../packages/protocol/src/index.js";
import { Database, type TaskRecord } from "../../database/database.js";

const DEFAULT_PERMISSIONS: Permission[] = ["connector.health"];

export class ConnectorService {
  private readonly taskTimers = new Map<string, NodeJS.Timeout>();

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
    const tokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    this.database.createConnector({
      connectorId: request.connectorId,
      deviceId,
      deviceName: request.deviceName,
      platform: request.platform,
      status: "pending",
      accessToken: accessTokenHash,
      tokenExpiresAt,
      permissions: DEFAULT_PERMISSIONS,
      lastSeenAt: null,
    });
    this.database.addAudit("connector.paired", request.connectorId, { deviceId, platform: request.platform });
    return { type: "pairing.accepted", connectorId: request.connectorId, deviceId, accessToken, permissions: DEFAULT_PERMISSIONS, tokenExpiresAt };
  }

  authenticate(connectorId: string, accessToken: string): boolean {
    const record = this.database.getConnector(connectorId);
    const accessTokenHash = createHash("sha256").update(accessToken).digest("hex");
    return Boolean(record && record.status !== "revoked" && record.accessToken === accessTokenHash && (!record.tokenExpiresAt || record.tokenExpiresAt > new Date().toISOString()));
  }

  rotateToken(connectorId: string): { accessToken: string; tokenExpiresAt: string } | null {
    const accessToken = randomBytes(32).toString("hex");
    const tokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const changed = this.database.rotateAccessToken(connectorId, createHash("sha256").update(accessToken).digest("hex"), tokenExpiresAt);
    if (!changed) return null;
    this.database.addAudit("connector.token.rotated", connectorId, { tokenExpiresAt });
    return { accessToken, tokenExpiresAt };
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
      : operation === "models.execute" || operation === "models.stream" ? "model.use"
      : operation === "filesystem.list" || operation === "filesystem.read" || operation === "artifact.collect" ? "filesystem.read"
      : operation === "filesystem.write" ? "filesystem.write"
      : operation === "git.status" ? "git.read"
      : operation === "process.list" || operation === "process.start" || operation === "process.stop" ? "process.manage"
      : operation === "terminal.execute" ? "terminal.execute"
      : operation === "testing.run" ? "testing.execute"
      : operation === "building.run" ? "building.execute"
      : "connector.health";
    if (!record || !record.permissions.includes(requiredPermission) || record.status === "revoked") return null;
    const requestId = randomUUID();
    const message: OperationRequest = { type: "operation.request", requestId, operation, input };
    socket.send(JSON.stringify(message));
    this.database.addAudit("operation.requested", connectorId, { requestId, operation, requiredPermission });
    return requestId;
  }

  createTask(connectorId: string, operation: OperationRequest["operation"], input: Record<string, unknown> = {}, timeoutMs = 30_000): TaskRecord | null {
    const connector = this.database.getConnector(connectorId);
    if (!connector || connector.status === "revoked") return null;
    const requiredPermission: Permission = operation === "models.discover" ? "model.discovery" : operation === "models.execute" || operation === "models.stream" ? "model.use" : operation === "filesystem.list" || operation === "filesystem.read" || operation === "artifact.collect" ? "filesystem.read" : operation === "filesystem.write" ? "filesystem.write" : operation === "git.status" ? "git.read" : operation === "process.list" || operation === "process.start" || operation === "process.stop" ? "process.manage" : operation === "terminal.execute" ? "terminal.execute" : operation === "testing.run" ? "testing.execute" : operation === "building.run" ? "building.execute" : "connector.health";
    if (!connector.permissions.includes(requiredPermission)) return null;
    const task: TaskRecord = { taskId: randomUUID(), connectorId, operation, input, status: "queued", progress: 0, progressMessage: null, result: null, error: null, timeoutMs: Math.min(Math.max(timeoutMs, 100), 300_000), attempts: 0, artifactMetadata: [], createdAt: new Date().toISOString(), startedAt: null, finishedAt: null };
    this.database.createTask(task);
    this.database.addAudit("task.created", connectorId, { taskId: task.taskId, operation });
    return task;
  }

  dispatchTask(taskId: string, socket: WebSocket): boolean {
    const task = this.database.getTask(taskId);
    if (!task || task.status !== "queued") return false;
    this.database.updateTask(taskId, { status: "running", startedAt: new Date().toISOString(), attempts: task.attempts + 1, progress: 5, progressMessage: "Dispatched to connector" });
    socket.send(JSON.stringify({ type: "operation.request", requestId: task.taskId, taskId: task.taskId, operation: task.operation as OperationRequest["operation"], input: task.input, timeoutMs: task.timeoutMs } satisfies OperationRequest));
    const timer = setTimeout(() => {
      const current = this.database.getTask(taskId);
      if (current && ["queued", "running"].includes(current.status)) this.database.updateTask(taskId, { status: "timed_out", error: { code: "TASK_TIMEOUT", message: "Task exceeded its timeout" }, finishedAt: new Date().toISOString(), progress: 100, progressMessage: "Timed out" });
      this.taskTimers.delete(taskId);
    }, task.timeoutMs);
    this.taskTimers.set(taskId, timer);
    return true;
  }

  recordOperationResult(result: OperationResult, connectorId: string): void {
    this.database.addAudit("operation.result", connectorId, { requestId: result.requestId, ok: result.ok, result: result.result, error: result.error });
    if (!result.taskId) return;
    const task = this.database.getTask(result.taskId);
    if (!task || task.connectorId !== connectorId || ["cancelled", "timed_out"].includes(task.status)) return;
    const timer = this.taskTimers.get(result.taskId);
    if (timer) clearTimeout(timer);
    this.taskTimers.delete(result.taskId);
    this.database.updateTask(result.taskId, { status: result.ok ? "succeeded" : "failed", progress: 100, progressMessage: result.ok ? "Completed" : "Failed", result: result.result ?? null, error: result.error ?? null, finishedAt: new Date().toISOString() });
    this.database.addAudit(result.ok ? "task.succeeded" : "task.failed", connectorId, { taskId: result.taskId });
  }

  recordTaskProgress(message: TaskProgressMessage, connectorId: string): void {
    const task = this.database.getTask(message.taskId);
    if (!task || task.connectorId !== connectorId || !["queued", "running"].includes(task.status)) return;
    this.database.updateTask(message.taskId, { status: "running", progress: Math.min(99, Math.max(0, message.progress)), progressMessage: message.message ?? null });
  }

  cancelTask(taskId: string, connectorId: string, socket?: WebSocket): boolean {
    const task = this.database.getTask(taskId);
    if (!task || task.connectorId !== connectorId || ["succeeded", "failed", "cancelled", "timed_out"].includes(task.status)) return false;
    const timer = this.taskTimers.get(taskId);
    if (timer) clearTimeout(timer);
    this.taskTimers.delete(taskId);
    this.database.updateTask(taskId, { status: "cancelled", progress: 100, progressMessage: "Cancelled", error: { code: "TASK_CANCELLED", message: "Task cancelled by request" }, finishedAt: new Date().toISOString() });
    if (socket) socket.send(JSON.stringify({ type: "task.cancel", taskId }));
    this.database.addAudit("task.cancelled", connectorId, { taskId });
    return true;
  }

  retryTask(taskId: string, connectorId: string, socket?: WebSocket): boolean {
    const task = this.database.getTask(taskId);
    if (!task || task.connectorId !== connectorId || !["failed", "timed_out", "cancelled"].includes(task.status) || !socket) return false;
    this.database.updateTask(taskId, { status: "queued", progress: 0, progressMessage: "Queued for retry", result: null, error: null, finishedAt: null });
    return this.dispatchTask(taskId, socket);
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

  acknowledgePermissions(connectorId: string, permissions: Permission[]): void {
    const record = this.database.getConnector(connectorId);
    if (record && JSON.stringify(record.permissions) === JSON.stringify(permissions)) this.database.addAudit("connector.permissions.acknowledged", connectorId, { permissions });
  }

  getConnector(connectorId: string) {
    return this.database.getConnector(connectorId);
  }

  getTask(taskId: string): TaskRecord | null { return this.database.getTask(taskId); }
}
