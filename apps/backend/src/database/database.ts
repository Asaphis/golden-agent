import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface ConnectorRecord {
  connectorId: string;
  deviceId: string;
  deviceName: string;
  platform: string;
  status: "pending" | "online" | "offline" | "revoked";
  accessToken: string | null;
  tokenExpiresAt: string | null;
  permissions: string[];
  capabilities?: string[];
  lastSeenAt: string | null;
}

export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out";
export interface TaskRecord {
  taskId: string;
  connectorId: string;
  operation: string;
  input: Record<string, unknown>;
  status: TaskStatus;
  progress: number;
  progressMessage: string | null;
  result: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
  timeoutMs: number;
  attempts: number;
  artifactMetadata: Array<Record<string, unknown>>;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ConversationRecord {
  conversationId: string;
  workspaceId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  messageId: string;
  conversationId: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ProviderRecord {
  providerId: string;
  name: string;
  type: string;
  status: "active" | "disabled";
  config: Record<string, unknown>;
  createdAt: string;
}

export interface ModelRecord {
  modelId: string;
  providerId: string;
  externalId: string;
  displayName: string;
  capabilities: string[];
  enabled: boolean;
  createdAt: string;
}

export interface PermissionRequestRecord {
  requestId: string;
  taskId: string | null;
  connectorId: string | null;
  permission: string;
  scope: string;
  status: "pending" | "approved" | "denied";
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export interface TaskEventRecord {
  eventId: string;
  taskId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface UserRecord {
  userId: string;
  email: string;
  passwordHash: string;
  displayName: string;
  createdAt: string;
}

export interface SessionRecord {
  sessionId: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export interface WorkspaceMemberRecord {
  workspaceId: string;
  userId: string;
  role: "owner" | "admin" | "member" | "viewer";
  createdAt: string;
}

export interface WorkspaceInvitationRecord {
  invitationId: string;
  workspaceId: string;
  email: string;
  role: WorkspaceMemberRecord["role"];
  tokenHash: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  createdAt: string;
}

export class Database {
  readonly db: DatabaseSync;

  constructor(databasePath = process.env.DATABASE_PATH ?? "./.data/golden-agent.sqlite") {
    const absolutePath = resolve(databasePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    this.db = new DatabaseSync(absolutePath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pairing_requests (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS connectors (
        connector_id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL UNIQUE,
        device_name TEXT NOT NULL,
        platform TEXT NOT NULL,
        status TEXT NOT NULL,
        access_token TEXT,
        permissions_json TEXT NOT NULL,
        capabilities_json TEXT NOT NULL DEFAULT '[]',
        last_seen_at TEXT
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        connector_id TEXT,
        details_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        task_id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        input_json TEXT NOT NULL,
        status TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        progress_message TEXT,
        result_json TEXT,
        error_json TEXT,
        timeout_ms INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        artifacts_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );
      CREATE TABLE IF NOT EXISTS workspaces (
        workspace_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversations (
        conversation_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(workspace_id)
      );
      CREATE TABLE IF NOT EXISTS messages (
        message_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id)
      );
      CREATE TABLE IF NOT EXISTS providers (
        provider_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        config_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS models (
        model_id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        external_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        capabilities_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        UNIQUE(provider_id, external_id),
        FOREIGN KEY (provider_id) REFERENCES providers(provider_id)
      );
      CREATE TABLE IF NOT EXISTS permission_requests (
        request_id TEXT PRIMARY KEY,
        task_id TEXT,
        connector_id TEXT,
        permission TEXT NOT NULL,
        scope TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        resolved_by TEXT
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        artifact_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mime_type TEXT,
        size INTEGER,
        path TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_events (
        event_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(task_id)
      );
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(user_id)
      );
      CREATE TABLE IF NOT EXISTS workspace_members (
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, user_id),
        FOREIGN KEY (workspace_id) REFERENCES workspaces(workspace_id),
        FOREIGN KEY (user_id) REFERENCES users(user_id)
      );
      CREATE TABLE IF NOT EXISTS workspace_invitations (
        invitation_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        email TEXT NOT NULL,
        role TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(workspace_id)
      );
    `);
    this.db.prepare("INSERT OR IGNORE INTO workspaces (workspace_id, name, created_at) VALUES (?, ?, ?)").run("default", "Default Workspace", new Date().toISOString());
    try { this.db.exec("ALTER TABLE connectors ADD COLUMN token_expires_at TEXT"); } catch { /* already migrated */ }
    try { this.db.exec("ALTER TABLE connectors ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '[]'"); } catch { /* already migrated */ }
  }

  createPairing(id: string, code: string, expiresAt: string): void {
    this.db.prepare(
      "INSERT INTO pairing_requests (id, code, created_at, expires_at) VALUES (?, ?, ?, ?)"
    ).run(id, code, new Date().toISOString(), expiresAt);
  }

  consumePairing(code: string): boolean {
    const row = this.db.prepare(
      "SELECT id FROM pairing_requests WHERE code = ? AND status = 'pending' AND expires_at > ?"
    ).get(code, new Date().toISOString()) as { id?: string } | undefined;
    if (!row?.id) return false;
    this.db.prepare(
      "UPDATE pairing_requests SET status = 'consumed', consumed_at = ? WHERE id = ?"
    ).run(new Date().toISOString(), row.id);
    return true;
  }

  createConnector(record: ConnectorRecord): void {
    this.db.prepare(`
      INSERT INTO connectors
      (connector_id, device_id, device_name, platform, status, access_token, permissions_json, capabilities_json, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.connectorId,
      record.deviceId,
      record.deviceName,
      record.platform,
      record.status,
      record.accessToken,
      JSON.stringify(record.permissions),
      JSON.stringify(record.capabilities ?? []),
      record.lastSeenAt,
    );
    this.db.prepare("UPDATE connectors SET token_expires_at = ? WHERE connector_id = ?").run(record.tokenExpiresAt, record.connectorId);
  }

  getConnector(connectorId: string): ConnectorRecord | null {
    const row = this.db.prepare("SELECT * FROM connectors WHERE connector_id = ?").get(connectorId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      connectorId: String(row.connector_id),
      deviceId: String(row.device_id),
      deviceName: String(row.device_name),
      platform: String(row.platform),
      status: row.status as ConnectorRecord["status"],
      accessToken: row.access_token ? String(row.access_token) : null,
      tokenExpiresAt: row.token_expires_at ? String(row.token_expires_at) : null,
      permissions: JSON.parse(String(row.permissions_json)) as string[],
      capabilities: row.capabilities_json ? JSON.parse(String(row.capabilities_json)) as string[] : [],
      lastSeenAt: row.last_seen_at ? String(row.last_seen_at) : null,
    };
  }

  listConnectors(): ConnectorRecord[] {
    const rows = this.db.prepare("SELECT * FROM connectors ORDER BY device_name ASC").all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({ connectorId: String(row.connector_id), deviceId: String(row.device_id), deviceName: String(row.device_name), platform: String(row.platform), status: row.status as ConnectorRecord["status"], accessToken: null, tokenExpiresAt: row.token_expires_at ? String(row.token_expires_at) : null, permissions: JSON.parse(String(row.permissions_json)) as string[], capabilities: row.capabilities_json ? JSON.parse(String(row.capabilities_json)) as string[] : [], lastSeenAt: row.last_seen_at ? String(row.last_seen_at) : null }));
  }

  updateHeartbeat(connectorId: string, timestamp: string, capabilities: string[] = []): void {
    this.db.prepare("UPDATE connectors SET status = 'online', last_seen_at = ?, capabilities_json = ? WHERE connector_id = ? AND status != 'revoked'").run(timestamp, JSON.stringify(capabilities), connectorId);
  }

  updatePermissions(connectorId: string, permissions: string[]): boolean {
    const result = this.db.prepare("UPDATE connectors SET permissions_json = ? WHERE connector_id = ? AND status != 'revoked'").run(JSON.stringify(permissions), connectorId);
    return Number(result.changes) > 0;
  }

  rotateAccessToken(connectorId: string, tokenHash: string, expiresAt: string): boolean {
    const result = this.db.prepare("UPDATE connectors SET access_token = ?, token_expires_at = ?, status = 'pending' WHERE connector_id = ? AND status != 'revoked'").run(tokenHash, expiresAt, connectorId);
    return Number(result.changes) > 0;
  }

  revokeConnector(connectorId: string): boolean {
    const result = this.db.prepare("UPDATE connectors SET status = 'revoked', access_token = NULL WHERE connector_id = ?").run(connectorId);
    return Number(result.changes) > 0;
  }

  addAudit(eventType: string, connectorId: string | null, details: Record<string, unknown>): void {
    this.db.prepare("INSERT INTO audit_events (event_type, connector_id, details_json, created_at) VALUES (?, ?, ?, ?)").run(
      eventType,
      connectorId,
      JSON.stringify(details),
      new Date().toISOString(),
    );
  }

  createTask(task: TaskRecord): void {
    this.db.prepare(`INSERT INTO tasks
      (task_id, connector_id, operation, input_json, status, progress, progress_message, result_json, error_json, timeout_ms, attempts, artifacts_json, created_at, started_at, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(task.taskId, task.connectorId, task.operation, JSON.stringify(task.input), task.status, task.progress, task.progressMessage, null, null, task.timeoutMs, task.attempts, JSON.stringify(task.artifactMetadata), task.createdAt, task.startedAt, task.finishedAt);
  }

  getTask(taskId: string): TaskRecord | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { taskId: String(row.task_id), connectorId: String(row.connector_id), operation: String(row.operation), input: JSON.parse(String(row.input_json)), status: row.status as TaskStatus, progress: Number(row.progress), progressMessage: row.progress_message ? String(row.progress_message) : null, result: row.result_json ? JSON.parse(String(row.result_json)) : null, error: row.error_json ? JSON.parse(String(row.error_json)) : null, timeoutMs: Number(row.timeout_ms), attempts: Number(row.attempts), artifactMetadata: JSON.parse(String(row.artifacts_json)), createdAt: String(row.created_at), startedAt: row.started_at ? String(row.started_at) : null, finishedAt: row.finished_at ? String(row.finished_at) : null };
  }

  updateTask(taskId: string, patch: Partial<Pick<TaskRecord, "status" | "progress" | "progressMessage" | "result" | "error" | "attempts" | "startedAt" | "finishedAt" | "artifactMetadata">>): void {
    const current = this.getTask(taskId);
    if (!current) return;
    const next = { ...current, ...patch };
    this.db.prepare("UPDATE tasks SET status = ?, progress = ?, progress_message = ?, result_json = ?, error_json = ?, attempts = ?, artifacts_json = ?, started_at = ?, finished_at = ? WHERE task_id = ?").run(next.status, next.progress, next.progressMessage, next.result ? JSON.stringify(next.result) : null, next.error ? JSON.stringify(next.error) : null, next.attempts, JSON.stringify(next.artifactMetadata), next.startedAt, next.finishedAt, taskId);
  }

  createConversation(record: ConversationRecord): void {
    this.db.prepare("INSERT INTO conversations (conversation_id, workspace_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(record.conversationId, record.workspaceId, record.title, record.createdAt, record.updatedAt);
  }

  listConversations(workspaceId = "default"): ConversationRecord[] {
    const rows = this.db.prepare("SELECT * FROM conversations WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspaceId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ conversationId: String(row.conversation_id), workspaceId: String(row.workspace_id), title: String(row.title), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }));
  }

  getConversation(conversationId: string): ConversationRecord | null {
    const row = this.db.prepare("SELECT * FROM conversations WHERE conversation_id = ?").get(conversationId) as Record<string, unknown> | undefined;
    return row ? { conversationId: String(row.conversation_id), workspaceId: String(row.workspace_id), title: String(row.title), createdAt: String(row.created_at), updatedAt: String(row.updated_at) } : null;
  }

  addMessage(record: MessageRecord): void {
    this.db.prepare("INSERT INTO messages (message_id, conversation_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(record.messageId, record.conversationId, record.role, record.content, JSON.stringify(record.metadata), record.createdAt);
    this.db.prepare("UPDATE conversations SET updated_at = ? WHERE conversation_id = ?").run(record.createdAt, record.conversationId);
  }

  listMessages(conversationId: string): MessageRecord[] {
    const rows = this.db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC").all(conversationId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ messageId: String(row.message_id), conversationId: String(row.conversation_id), role: row.role as MessageRecord["role"], content: String(row.content), metadata: JSON.parse(String(row.metadata_json)) as Record<string, unknown>, createdAt: String(row.created_at) }));
  }

  upsertProvider(record: ProviderRecord): void {
    this.db.prepare("INSERT INTO providers (provider_id, name, type, status, config_json, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(provider_id) DO UPDATE SET name = excluded.name, type = excluded.type, status = excluded.status, config_json = excluded.config_json").run(record.providerId, record.name, record.type, record.status, JSON.stringify(record.config), record.createdAt);
  }

  listProviders(): ProviderRecord[] {
    const rows = this.db.prepare("SELECT * FROM providers ORDER BY name ASC").all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({ providerId: String(row.provider_id), name: String(row.name), type: String(row.type), status: row.status as ProviderRecord["status"], config: JSON.parse(String(row.config_json)) as Record<string, unknown>, createdAt: String(row.created_at) }));
  }

  upsertModel(record: ModelRecord): void {
    this.db.prepare("INSERT INTO models (model_id, provider_id, external_id, display_name, capabilities_json, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(model_id) DO UPDATE SET display_name = excluded.display_name, capabilities_json = excluded.capabilities_json, enabled = excluded.enabled").run(record.modelId, record.providerId, record.externalId, record.displayName, JSON.stringify(record.capabilities), record.enabled ? 1 : 0, record.createdAt);
  }

  listModels(): ModelRecord[] {
    const rows = this.db.prepare("SELECT * FROM models ORDER BY display_name ASC").all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({ modelId: String(row.model_id), providerId: String(row.provider_id), externalId: String(row.external_id), displayName: String(row.display_name), capabilities: JSON.parse(String(row.capabilities_json)) as string[], enabled: Boolean(row.enabled), createdAt: String(row.created_at) }));
  }

  createPermissionRequest(record: PermissionRequestRecord): void {
    this.db.prepare("INSERT INTO permission_requests (request_id, task_id, connector_id, permission, scope, status, created_at, resolved_at, resolved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(record.requestId, record.taskId, record.connectorId, record.permission, record.scope, record.status, record.createdAt, record.resolvedAt, record.resolvedBy);
  }

  listPermissionRequests(status?: PermissionRequestRecord["status"]): PermissionRequestRecord[] {
    const rows = (status ? this.db.prepare("SELECT * FROM permission_requests WHERE status = ? ORDER BY created_at DESC").all(status) : this.db.prepare("SELECT * FROM permission_requests ORDER BY created_at DESC").all()) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ requestId: String(row.request_id), taskId: row.task_id ? String(row.task_id) : null, connectorId: row.connector_id ? String(row.connector_id) : null, permission: String(row.permission), scope: String(row.scope), status: row.status as PermissionRequestRecord["status"], createdAt: String(row.created_at), resolvedAt: row.resolved_at ? String(row.resolved_at) : null, resolvedBy: row.resolved_by ? String(row.resolved_by) : null }));
  }

  getPermissionRequest(requestId: string): PermissionRequestRecord | null {
    return this.listPermissionRequests().find((request) => request.requestId === requestId) ?? null;
  }

  resolvePermissionRequest(requestId: string, status: "approved" | "denied", resolvedBy: string): boolean {
    const result = this.db.prepare("UPDATE permission_requests SET status = ?, resolved_at = ?, resolved_by = ? WHERE request_id = ? AND status = 'pending'").run(status, new Date().toISOString(), resolvedBy, requestId);
    return Number(result.changes) > 0;
  }

  addTaskEvent(event: TaskEventRecord): void {
    this.db.prepare("INSERT INTO task_events (event_id, task_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)").run(event.eventId, event.taskId, event.type, JSON.stringify(event.payload), event.createdAt);
  }

  listTaskEvents(taskId: string): TaskEventRecord[] {
    const rows = this.db.prepare("SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at ASC").all(taskId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ eventId: String(row.event_id), taskId: String(row.task_id), type: String(row.type), payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>, createdAt: String(row.created_at) }));
  }

  createUser(record: UserRecord): void {
    this.db.prepare("INSERT INTO users (user_id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)").run(record.userId, record.email, record.passwordHash, record.displayName, record.createdAt);
  }

  getUserByEmail(email: string): UserRecord | null {
    const row = this.db.prepare("SELECT * FROM users WHERE email = ?").get(email) as Record<string, unknown> | undefined;
    return row ? { userId: String(row.user_id), email: String(row.email), passwordHash: String(row.password_hash), displayName: String(row.display_name), createdAt: String(row.created_at) } : null;
  }

  getUser(userId: string): UserRecord | null {
    const row = this.db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId) as Record<string, unknown> | undefined;
    return row ? { userId: String(row.user_id), email: String(row.email), passwordHash: String(row.password_hash), displayName: String(row.display_name), createdAt: String(row.created_at) } : null;
  }

  createSession(record: SessionRecord): void {
    this.db.prepare("INSERT INTO sessions (session_id, user_id, token_hash, expires_at, revoked_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(record.sessionId, record.userId, record.tokenHash, record.expiresAt, record.revokedAt, record.createdAt, record.lastSeenAt);
  }

  getSessionByTokenHash(tokenHash: string): SessionRecord | null {
    const row = this.db.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(tokenHash) as Record<string, unknown> | undefined;
    return row ? { sessionId: String(row.session_id), userId: String(row.user_id), tokenHash: String(row.token_hash), expiresAt: String(row.expires_at), revokedAt: row.revoked_at ? String(row.revoked_at) : null, createdAt: String(row.created_at), lastSeenAt: String(row.last_seen_at) } : null;
  }

  listSessions(userId: string): Array<Omit<SessionRecord, "tokenHash">> {
    const rows = this.db.prepare("SELECT session_id, user_id, expires_at, revoked_at, created_at, last_seen_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC").all(userId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ sessionId: String(row.session_id), userId: String(row.user_id), expiresAt: String(row.expires_at), revokedAt: row.revoked_at ? String(row.revoked_at) : null, createdAt: String(row.created_at), lastSeenAt: String(row.last_seen_at) }));
  }

  touchSession(sessionId: string, lastSeenAt: string): void { this.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE session_id = ? AND revoked_at IS NULL").run(lastSeenAt, sessionId); }
  revokeSession(sessionId: string, userId: string): boolean { const result = this.db.prepare("UPDATE sessions SET revoked_at = ? WHERE session_id = ? AND user_id = ? AND revoked_at IS NULL").run(new Date().toISOString(), sessionId, userId); return Number(result.changes) > 0; }

  addWorkspaceMember(record: WorkspaceMemberRecord): void {
    this.db.prepare("INSERT OR REPLACE INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)").run(record.workspaceId, record.userId, record.role, record.createdAt);
  }

  getWorkspaceMember(workspaceId: string, userId: string): WorkspaceMemberRecord | null {
    const row = this.db.prepare("SELECT * FROM workspace_members WHERE workspace_id = ? AND user_id = ?").get(workspaceId, userId) as Record<string, unknown> | undefined;
    return row ? { workspaceId: String(row.workspace_id), userId: String(row.user_id), role: row.role as WorkspaceMemberRecord["role"], createdAt: String(row.created_at) } : null;
  }

  listWorkspaceMembers(workspaceId: string): Array<WorkspaceMemberRecord & { email: string; displayName: string }> {
    const rows = this.db.prepare("SELECT wm.*, u.email, u.display_name FROM workspace_members wm JOIN users u ON u.user_id = wm.user_id WHERE wm.workspace_id = ? ORDER BY wm.created_at ASC").all(workspaceId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ workspaceId: String(row.workspace_id), userId: String(row.user_id), role: row.role as WorkspaceMemberRecord["role"], createdAt: String(row.created_at), email: String(row.email), displayName: String(row.display_name) }));
  }

  createWorkspaceInvitation(record: WorkspaceInvitationRecord): void {
    this.db.prepare("INSERT INTO workspace_invitations (invitation_id, workspace_id, email, role, token_hash, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(record.invitationId, record.workspaceId, record.email, record.role, record.tokenHash, record.status, record.expiresAt, record.createdAt);
  }

  getWorkspaceInvitationByToken(tokenHash: string): WorkspaceInvitationRecord | null {
    const row = this.db.prepare("SELECT * FROM workspace_invitations WHERE token_hash = ?").get(tokenHash) as Record<string, unknown> | undefined;
    return row ? { invitationId: String(row.invitation_id), workspaceId: String(row.workspace_id), email: String(row.email), role: row.role as WorkspaceMemberRecord["role"], tokenHash: String(row.token_hash), status: row.status as WorkspaceInvitationRecord["status"], expiresAt: String(row.expires_at), createdAt: String(row.created_at) } : null;
  }

  updateWorkspaceInvitation(invitationId: string, status: WorkspaceInvitationRecord["status"]): void { this.db.prepare("UPDATE workspace_invitations SET status = ? WHERE invitation_id = ?").run(status, invitationId); }

  close(): void {
    this.db.close();
  }
}
