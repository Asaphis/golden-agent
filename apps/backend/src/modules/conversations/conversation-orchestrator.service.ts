import { ConversationService } from "./conversation.service.js";
import { ModelGatewayService } from "../models/model-gateway.service.js";
import { AgentToolService } from "../tools/agent-tool.service.js";
import type { MessageRecord } from "../../database/database.js";

export class ConversationOrchestratorService {
  constructor(
    private readonly conversations: ConversationService,
    private readonly models: ModelGatewayService,
    private readonly agentTools: AgentToolService,
  ) {}

  private prompt(messages: MessageRecord[]): string {
    return messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
  }

  async *respond(input: { conversationId: string; modelId: string; content: string; workspaceId: string; ownerUserId: string; connectorId?: string; timeoutMs?: number }): AsyncGenerator<{ type: "user.message" | "assistant.chunk" | "assistant.done" | "tool.requested" | "error"; message?: MessageRecord; chunk?: string; tool?: Record<string, unknown>; error?: string }, void, void> {
    const existing = this.conversations.get(input.conversationId);
    if (!existing || existing.conversation.workspaceId !== input.workspaceId) throw new Error("CONVERSATION_NOT_FOUND_OR_ACCESS_DENIED");
    if (!input.content.trim()) throw new Error("MESSAGE_CONTENT_REQUIRED");

    const userMessage = this.conversations.addMessage(input.conversationId, "user", input.content.trim(), { modelId: input.modelId });
    if (!userMessage) throw new Error("CONVERSATION_NOT_FOUND");
    yield { type: "user.message", message: userMessage };

    const history = this.conversations.get(input.conversationId)?.messages ?? [userMessage];
    const chunks: string[] = [];
    for await (const chunk of this.models.stream(input.modelId, input.workspaceId, this.prompt(history), input.timeoutMs)) {
      chunks.push(chunk);
      yield { type: "assistant.chunk", chunk };
    }

    const assistantMessage = this.conversations.addMessage(input.conversationId, "assistant", chunks.join(""), { modelId: input.modelId, streamed: true });
    if (!assistantMessage) throw new Error("CONVERSATION_NOT_FOUND");
    yield { type: "assistant.done", message: assistantMessage };

    const match = chunks.join("").match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i);
    if (!match) return;
    let request: { tool?: unknown; connectorId?: unknown; arguments?: unknown };
    try { request = JSON.parse(match[1]) as { tool?: unknown; connectorId?: unknown; arguments?: unknown }; } catch { yield { type: "error", error: "INVALID_TOOL_CALL_JSON" }; return; }
    if (typeof request.tool !== "string") { yield { type: "error", error: "TOOL_NAME_REQUIRED" }; return; }
    const connectorId = typeof request.connectorId === "string" ? request.connectorId : input.connectorId;
    if (!connectorId) { yield { type: "error", error: "TOOL_CONNECTOR_REQUIRED" }; return; }
    try {
      const result = this.agentTools.execute({ tool: request.tool, connectorId, arguments: (request.arguments ?? {}) as Record<string, unknown>, ownerUserId: input.ownerUserId, workspaceId: input.workspaceId, timeoutMs: input.timeoutMs });
      yield { type: "tool.requested", tool: { ...result, connectorId } };
    } catch (error) {
      yield { type: "error", error: error instanceof Error ? error.message : "TOOL_EXECUTION_FAILED" };
    }
  }
}
