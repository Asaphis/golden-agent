import { ConversationService } from "./conversation.service.js";
import { ModelGatewayService } from "../models/model-gateway.service.js";
import type { MessageRecord } from "../../database/database.js";

export class ConversationOrchestratorService {
  constructor(
    private readonly conversations: ConversationService,
    private readonly models: ModelGatewayService,
  ) {}

  private prompt(messages: MessageRecord[]): string {
    return messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
  }

  async *respond(input: { conversationId: string; modelId: string; content: string; workspaceId: string; timeoutMs?: number }): AsyncGenerator<{ type: "user.message" | "assistant.chunk" | "assistant.done"; message?: MessageRecord; chunk?: string }, void, void> {
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
  }
}
