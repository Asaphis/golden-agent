import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { OperationRequest, Permission } from "../../../../../packages/protocol/src/index.js";
import { Database, type PermissionRequestRecord } from "../../database/database.js";
import { ConnectorService } from "../connectors/connector.service.js";

export function requiredPermission(operation: OperationRequest["operation"]): Permission {
  if (operation === "models.discover") return "model.discovery";
  if (operation === "models.execute" || operation === "models.stream") return "model.use";
  if (operation.startsWith("browser.")) return "browser.use";
  if (operation === "filesystem.list" || operation === "filesystem.read" || operation === "artifact.collect") return "filesystem.read";
  if (operation === "filesystem.write") return "filesystem.write";
  if (operation === "git.status") return "git.read";
  if (operation.startsWith("process.")) return "process.manage";
  if (operation === "terminal.execute") return "terminal.execute";
  if (operation === "testing.run") return "testing.execute";
  if (operation === "building.run") return "building.execute";
  return "connector.health";
}

export class TaskOrchestrator {
  constructor(
    private readonly database: Database,
    private readonly connectors: ConnectorService,
    private readonly socketForConnector: (connectorId: string) => WebSocket | undefined,
  ) {}

  createOrDispatch(input: { connectorId: string; operation: OperationRequest["operation"]; taskInput?: Record<string, unknown>; timeoutMs?: number }): { task: ReturnType<ConnectorService["getTask"]>; permissionRequest?: PermissionRequestRecord } {
    const connector = this.connectors.getConnector(input.connectorId);
    if (!connector || connector.status === "revoked") throw new Error("CONNECTOR_NOT_AVAILABLE");
    const permission = requiredPermission(input.operation);
    if (!connector.permissions.includes(permission)) {
      const request: PermissionRequestRecord = { requestId: randomUUID(), taskId: null, connectorId: input.connectorId, permission, scope: "connector", status: "pending", createdAt: new Date().toISOString(), resolvedAt: null, resolvedBy: null };
      this.database.createPermissionRequest(request);
      this.database.addAudit("permission.requested", input.connectorId, { requestId: request.requestId, permission, operation: input.operation });
      return { task: null, permissionRequest: request };
    }
    const socket = this.socketForConnector(input.connectorId);
    if (!socket) throw new Error("CONNECTOR_OFFLINE");
    const task = this.connectors.createTask(input.connectorId, input.operation, input.taskInput ?? {}, input.timeoutMs ?? 30_000);
    if (!task || !this.connectors.dispatchTask(task.taskId, socket)) throw new Error("TASK_DISPATCH_FAILED");
    return { task };
  }

  listPermissionRequests(status?: PermissionRequestRecord["status"]): PermissionRequestRecord[] { return this.database.listPermissionRequests(status); }

  resolvePermission(requestId: string, approved: boolean, resolvedBy = "workspace"): PermissionRequestRecord {
    const request = this.database.getPermissionRequest(requestId);
    if (!request) throw new Error("PERMISSION_REQUEST_NOT_FOUND");
    if (!this.database.resolvePermissionRequest(requestId, approved ? "approved" : "denied", resolvedBy)) throw new Error("PERMISSION_REQUEST_ALREADY_RESOLVED");
    if (approved && request.connectorId) {
      const connector = this.connectors.getConnector(request.connectorId);
      const permission = request.permission as Permission;
      if (connector && !connector.permissions.includes(permission)) this.connectors.updatePermissions(request.connectorId, [...connector.permissions, permission] as Permission[]);
    }
    this.database.addAudit(approved ? "permission.approved" : "permission.denied", request.connectorId, { requestId, permission: request.permission, resolvedBy });
    return this.database.getPermissionRequest(requestId)!;
  }
}
