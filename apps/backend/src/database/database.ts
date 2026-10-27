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
  permissions: string[];
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
    `);
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
      (connector_id, device_id, device_name, platform, status, access_token, permissions_json, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.connectorId,
      record.deviceId,
      record.deviceName,
      record.platform,
      record.status,
      record.accessToken,
      JSON.stringify(record.permissions),
      record.lastSeenAt,
    );
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
      permissions: JSON.parse(String(row.permissions_json)) as string[],
      lastSeenAt: row.last_seen_at ? String(row.last_seen_at) : null,
    };
  }

  updateHeartbeat(connectorId: string, timestamp: string): void {
    this.db.prepare("UPDATE connectors SET status = 'online', last_seen_at = ? WHERE connector_id = ? AND status != 'revoked'").run(timestamp, connectorId);
  }

  updatePermissions(connectorId: string, permissions: string[]): boolean {
    const result = this.db.prepare("UPDATE connectors SET permissions_json = ? WHERE connector_id = ? AND status != 'revoked'").run(JSON.stringify(permissions), connectorId);
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

  close(): void {
    this.db.close();
  }
}
