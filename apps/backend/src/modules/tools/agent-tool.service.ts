import type { Permission, OperationRequest } from "../../../../../packages/protocol/src/index.js";
import { TaskOrchestrator } from "../tasks/task-orchestrator.service.js";
import { ToolRegistryService } from "./tool-registry.service.js";

export class AgentToolService {
  constructor(
    private readonly registry: ToolRegistryService,
    private readonly orchestrator: TaskOrchestrator,
  ) {}

  execute(input: { tool: string; connectorId: string; arguments?: Record<string, unknown>; ownerUserId: string; workspaceId: string; timeoutMs?: number }): { tool: string; operation: OperationRequest["operation"]; permission: Permission; status: "permission_required" | "dispatched"; task: ReturnType<TaskOrchestrator["createOrDispatch"]>["task"]; permissionRequest?: ReturnType<TaskOrchestrator["createOrDispatch"]>["permissionRequest"] } {
    const definition = this.registry.get(input.tool);
    if (!definition) throw new Error("TOOL_NOT_FOUND");
    const argumentsValue = input.arguments ?? {};
    this.registry.validate(definition, argumentsValue);
    const result = this.orchestrator.createOrDispatch({ connectorId: input.connectorId, operation: definition.operation, taskInput: argumentsValue, timeoutMs: input.timeoutMs, ownerUserId: input.ownerUserId, workspaceId: input.workspaceId });
    return { tool: definition.name, operation: definition.operation, permission: definition.permission, status: result.permissionRequest ? "permission_required" : "dispatched", task: result.task, permissionRequest: result.permissionRequest };
  }
}
