import { randomUUID } from "node:crypto";
import { Database, type ConversationRecord, type MessageRecord } from "../../database/database.js";

export class ConversationService {
  constructor(private readonly database: Database) {}

  create(title = "New conversation", workspaceId = "default"): ConversationRecord {
    const now = new Date().toISOString();
    const record: ConversationRecord = { conversationId: randomUUID(), workspaceId, title: title.trim().slice(0, 200) || "New conversation", createdAt: now, updatedAt: now };
    this.database.createConversation(record);
    return record;
  }

  list(workspaceId = "default"): ConversationRecord[] { return this.database.listConversations(workspaceId); }

  get(conversationId: string): { conversation: ConversationRecord; messages: MessageRecord[] } | null {
    const conversation = this.database.getConversation(conversationId);
    return conversation ? { conversation, messages: this.database.listMessages(conversationId) } : null;
  }

  addMessage(conversationId: string, role: MessageRecord["role"], content: string, metadata: Record<string, unknown> = {}): MessageRecord | null {
    if (!this.database.getConversation(conversationId)) return null;
    const record: MessageRecord = { messageId: randomUUID(), conversationId, role, content, metadata, createdAt: new Date().toISOString() };
    this.database.addMessage(record);
    return record;
  }
}
