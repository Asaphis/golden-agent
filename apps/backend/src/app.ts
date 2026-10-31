import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { Database } from "./database/database.js";
import { ConnectorService } from "./modules/connectors/connector.service.js";
import { ConversationService } from "./modules/conversations/conversation.service.js";
import { ModelRegistryService } from "./modules/models/model-registry.service.js";
import { TaskOrchestrator } from "./modules/tasks/task-orchestrator.service.js";
import { AccountService } from "./modules/auth/account.service.js";
import { WorkspaceAccessService } from "./modules/workspaces/workspace-access.service.js";
import type { AuthenticateMessage, ConnectorMessage, HeartbeatMessage, OperationResult, PairingRequest, Permission, TaskProgressMessage, PermissionsAcknowledgedMessage } from "../../../packages/protocol/src/index.js";

export interface BackendApp {
  server: ReturnType<typeof createServer>;
  database: Database;
  connectors: ConnectorService;
  conversations: ConversationService;
  models: ModelRegistryService;
  orchestrator: TaskOrchestrator;
  accounts: AccountService;
  workspaceAccess: WorkspaceAccessService;
  close(): Promise<void>;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  response.end(JSON.stringify(body));
}

function requestBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => { body += String(chunk); if (Buffer.byteLength(body, "utf8") > 1_000_000) { reject(new Error("REQUEST_TOO_LARGE")); request.destroy(); } });
    request.on("end", () => {
      try { resolve(body ? JSON.parse(body) as Record<string, unknown> : {}); } catch (error) { reject(error); }
    });
    request.on("error", reject);
  });
}

export function createBackendApp(databasePath = process.env.DATABASE_PATH): BackendApp {
  const database = new Database(databasePath);
  const accounts = new AccountService(database);
  const workspaceAccess = new WorkspaceAccessService(database);
  const conversations = new ConversationService(database);
  const models = new ModelRegistryService(database);
  const activeSockets = new Map<string, WebSocket>();
  const sockets = new Set<WebSocket>();
  const workspaceSockets = new Set<WebSocket>();
  const connectors = new ConnectorService(database, (event) => {
    const message = JSON.stringify({ type: "task.event", taskId: event.taskId, eventType: event.type, payload: event.payload });
    for (const socket of workspaceSockets) if (socket.readyState === 1) socket.send(message);
  });
  const orchestrator = new TaskOrchestrator(database, connectors, (connectorId) => activeSockets.get(connectorId));
  const rateWindows = new Map<string, { startedAt: number; count: number }>();
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "OPTIONS") return json(response, 204, {});
      const key = request.socket.remoteAddress ?? "unknown";
      const now = Date.now();
      const window = rateWindows.get(key);
      const current = !window || now - window.startedAt >= 60_000 ? { startedAt: now, count: 1 } : { startedAt: window.startedAt, count: window.count + 1 };
      rateWindows.set(key, current);
      if (current.count > 120) return json(response, 429, { ok: false, error: "RATE_LIMITED" });
      if (request.method === "GET" && request.url === "/health") return json(response, 200, { ok: true, service: "golden-agent-backend" });
      if (request.method === "GET" && request.url === "/ready") return json(response, 200, { ok: true, ready: true, service: "golden-agent-backend", database: "connected" });
      if (request.method === "POST" && request.url === "/v1/auth/register") {
        const body = await requestBody(request);
        const result = accounts.register({ email: String(body.email ?? ""), password: String(body.password ?? ""), displayName: typeof body.displayName === "string" ? body.displayName : undefined });
        return json(response, 201, { ok: true, ...result });
      }
      if (request.method === "POST" && request.url === "/v1/auth/login") {
        const body = await requestBody(request);
        const result = accounts.login(String(body.email ?? ""), String(body.password ?? ""));
        return json(response, 200, { ok: true, ...result });
      }
      const bearer = request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : "";
      const authenticated = bearer ? accounts.authenticate(bearer) : null;
      if (request.method === "GET" && request.url === "/v1/auth/me") return authenticated ? json(response, 200, { ok: true, user: authenticated.user, session: authenticated.session }) : json(response, 401, { ok: false, error: "AUTHENTICATION_REQUIRED" });
      if (request.method === "POST" && request.url === "/v1/auth/logout") {
        if (!authenticated) return json(response, 401, { ok: false, error: "AUTHENTICATION_REQUIRED" });
        return json(response, 200, { ok: accounts.logout(authenticated.session.sessionId, authenticated.user.userId) });
      }
      if (request.method === "GET" && request.url === "/v1/auth/sessions") return authenticated ? json(response, 200, { ok: true, sessions: accounts.sessions(authenticated.user.userId) }) : json(response, 401, { ok: false, error: "AUTHENTICATION_REQUIRED" });
      const sessionRevokeMatch = request.url?.match(/^\/v1\/auth\/sessions\/([^/]+)\/revoke$/);
      if (request.method === "POST" && sessionRevokeMatch) {
        if (!authenticated) return json(response, 401, { ok: false, error: "AUTHENTICATION_REQUIRED" });
        return json(response, 200, { ok: accounts.logout(sessionRevokeMatch[1], authenticated.user.userId) });
      }
      const membersMatch = request.url?.match(/^\/v1\/workspaces\/([^/]+)\/members$/);
      if (request.method === "GET" && membersMatch) {
        if (!authenticated) return json(response, 401, { ok: false, error: "AUTHENTICATION_REQUIRED" });
        return json(response, 200, { ok: true, members: workspaceAccess.members(membersMatch[1], authenticated.user.userId) });
      }
      const inviteMatch = request.url?.match(/^\/v1\/workspaces\/([^/]+)\/invitations$/);
      if (request.method === "POST" && inviteMatch) {
        if (!authenticated) return json(response, 401, { ok: false, error: "AUTHENTICATION_REQUIRED" });
        const body = await requestBody(request);
        return json(response, 201, { ok: true, ...workspaceAccess.invite(inviteMatch[1], authenticated.user.userId, { email: String(body.email ?? ""), role: body.role as "admin" | "member" | "viewer" | undefined }) });
      }
      if (request.method === "POST" && request.url === "/v1/workspace-invitations/accept") {
        if (!authenticated) return json(response, 401, { ok: false, error: "AUTHENTICATION_REQUIRED" });
        const body = await requestBody(request);
        return json(response, 200, { ok: true, membership: workspaceAccess.accept(String(body.token ?? ""), authenticated.user.userId, authenticated.user.email) });
      }
      if (request.method === "GET" && request.url?.startsWith("/v1/conversations")) {
        if (!authenticated) return json(response, 401, { ok: false, error: "AUTHENTICATION_REQUIRED" });
        const url = new URL(request.url, "http://localhost");
        const conversationId = url.pathname.split("/")[3];
        if (conversationId) {
          const result = conversations.get(conversationId);
          if (result && !database.getWorkspaceMember(result.conversation.workspaceId, authenticated.user.userId)) return json(response, 403, { ok: false, error: "WORKSPACE_ACCESS_DENIED" });
          return result ? json(response, 200, { ok: true, ...result }) : json(response, 404, { ok: false, error: "CONVERSATION_NOT_FOUND" });
        }
        const workspaceId = url.searchParams.get("workspaceId") ?? "default";
        if (!database.getWorkspaceMember(workspaceId, authenticated.user.userId)) return json(response, 403, { ok: false, error: "WORKSPACE_ACCESS_DENIED" });
        return json(response, 200, { ok: true, conversations: conversations.list(workspaceId) });
      }
      if (request.method === "POST" && request.url === "/v1/conversations") {
        if (!authenticated) return json(response, 401, { ok: false, error: "AUTHENTICATION_REQUIRED" });
        const body = await requestBody(request);
        const workspaceId = String(body.workspaceId ?? "default");
        if (!database.getWorkspaceMember(workspaceId, authenticated.user.userId)) return json(response, 403, { ok: false, error: "WORKSPACE_ACCESS_DENIED" });
        return json(response, 201, { ok: true, conversation: conversations.create(String(body.title ?? "New conversation"), workspaceId) });
      }
      const messageMatch = request.url?.match(/^\/v1\/conversations\/([^/]+)\/messages$/);
      if (request.method === "POST" && messageMatch) {
        if (!authenticated) return json(response, 401, { ok: false, error: "AUTHENTICATION_REQUIRED" });
        const existingConversation = conversations.get(messageMatch[1]);
        if (!existingConversation || !database.getWorkspaceMember(existingConversation.conversation.workspaceId, authenticated.user.userId)) return json(response, 403, { ok: false, error: "WORKSPACE_ACCESS_DENIED" });
        const body = await requestBody(request);
        const role = body.role === "system" || body.role === "user" || body.role === "assistant" || body.role === "tool" ? body.role : "user";
        const content = typeof body.content === "string" ? body.content : "";
        if (!content.trim()) return json(response, 400, { ok: false, error: "MESSAGE_CONTENT_REQUIRED" });
        const message = conversations.addMessage(messageMatch[1], role, content, (body.metadata ?? {}) as Record<string, unknown>);
        return message ? json(response, 201, { ok: true, message }) : json(response, 404, { ok: false, error: "CONVERSATION_NOT_FOUND" });
      }
      if (request.method === "GET" && request.url === "/v1/providers") {
        if (!authenticated || !database.getWorkspaceMember("default", authenticated.user.userId)) return json(response, 403, { ok: false, error: "WORKSPACE_ACCESS_DENIED" });
        return json(response, 200, { ok: true, providers: models.listProviders("default") });
      }
      if (request.method === "POST" && request.url === "/v1/providers") {
        if (!authenticated || !database.getWorkspaceMember("default", authenticated.user.userId)) return json(response, 403, { ok: false, error: "WORKSPACE_ACCESS_DENIED" });
        const body = await requestBody(request);
        return json(response, 201, { ok: true, provider: models.registerProvider({ name: String(body.name ?? ""), type: String(body.type ?? ""), config: (body.config ?? {}) as Record<string, unknown>, ownerUserId: authenticated.user.userId, workspaceId: "default" }) });
      }
      if (request.method === "GET" && request.url === "/v1/models") {
        if (!authenticated || !database.getWorkspaceMember("default", authenticated.user.userId)) return json(response, 403, { ok: false, error: "WORKSPACE_ACCESS_DENIED" });
        return json(response, 200, { ok: true, models: models.listModels("default") });
      }
      if (request.method === "POST" && request.url === "/v1/models") {
        if (!authenticated || !database.getWorkspaceMember("default", authenticated.user.userId)) return json(response, 403, { ok: false, error: "WORKSPACE_ACCESS_DENIED" });
        const body = await requestBody(request);
        return json(response, 201, { ok: true, model: models.registerModel({ providerId: String(body.providerId ?? ""), externalId: String(body.externalId ?? ""), displayName: typeof body.displayName === "string" ? body.displayName : undefined, capabilities: Array.isArray(body.capabilities) ? body.capabilities.map(String) : undefined, ownerUserId: authenticated.user.userId, workspaceId: "default" }) });
      }
      if (request.method === "GET" && request.url?.startsWith("/v1/permission-requests")) {
        const url = new URL(request.url, "http://localhost");
        const status = url.searchParams.get("status");
        return json(response, 200, { ok: true, requests: orchestrator.listPermissionRequests(status === "pending" || status === "approved" || status === "denied" ? status : undefined) });
      }
      const permissionResolveMatch = request.url?.match(/^\/v1\/permission-requests\/([^/]+)\/resolve$/);
      if (request.method === "POST" && permissionResolveMatch) {
        const body = await requestBody(request);
        const approved = body.approved === true;
        return json(response, 200, { ok: true, request: orchestrator.resolvePermission(permissionResolveMatch[1], approved, typeof body.resolvedBy === "string" ? body.resolvedBy : "workspace") });
      }
      if (request.method === "POST" && request.url === "/v1/tasks") {
        const body = await requestBody(request);
        if (typeof body.connectorId !== "string" || typeof body.operation !== "string") return json(response, 400, { ok: false, error: "CONNECTOR_AND_OPERATION_REQUIRED" });
        const result = orchestrator.createOrDispatch({ connectorId: body.connectorId, operation: body.operation as Parameters<ConnectorService["createTask"]>[1], taskInput: (body.input ?? {}) as Record<string, unknown>, timeoutMs: Number(body.timeoutMs ?? 30_000) });
        return result.permissionRequest ? json(response, 202, { ok: true, status: "permission_required", permissionRequest: result.permissionRequest }) : json(response, 202, { ok: true, status: "dispatched", task: result.task });
      }
      if (request.method === "POST" && request.url === "/v1/connectors/pairing") return json(response, 201, connectors.createPairing());
      if (request.method === "GET" && request.url?.startsWith("/v1/connectors")) {
        const url = new URL(request.url, "http://localhost");
        const connectorId = url.pathname.split("/")[3];
        if (!connectorId) return json(response, 200, { ok: true, connectors: database.listConnectors() });
      }
      const revokeMatch = request.url?.match(/^\/v1\/connectors\/([^/]+)\/revoke$/);
      if (request.method === "POST" && revokeMatch) {
        const ok = connectors.revoke(revokeMatch[1]);
        if (ok) activeSockets.get(revokeMatch[1])?.terminate();
        return json(response, ok ? 200 : 404, { ok });
      }
      const rotateMatch = request.url?.match(/^\/v1\/connectors\/([^/]+)\/rotate-token$/);
      if (request.method === "POST" && rotateMatch) {
        const rotated = connectors.rotateToken(rotateMatch[1]);
        const socket = activeSockets.get(rotateMatch[1]);
        if (rotated && socket) { socket.send(JSON.stringify({ type: "token.rotated", connectorId: rotateMatch[1], ...rotated })); socket.close(4001, "Token rotated"); }
        return rotated ? json(response, 200, { ok: true, tokenExpiresAt: rotated.tokenExpiresAt }) : json(response, 404, { ok: false });
      }
      const permissionsMatch = request.url?.match(/^\/v1\/connectors\/([^/]+)\/permissions$/);
      if (request.method === "POST" && permissionsMatch) {
        const body = await requestBody(request);
        const permissions = Array.isArray(body.permissions) ? body.permissions.map(String) as Permission[] : [];
        const ok = connectors.updatePermissions(permissionsMatch[1], permissions);
        return json(response, ok ? 200 : 404, { ok, permissions });
      }
      const operationMatch = request.url?.match(/^\/v1\/connectors\/([^/]+)\/operations$/);
      if (request.method === "POST" && operationMatch) {
        const body = await requestBody(request);
        const socket = activeSockets.get(operationMatch[1]);
        const operation = typeof body.operation === "string" ? body.operation as Parameters<ConnectorService["requestOperation"]>[2] : undefined;
        if (!socket || !operation) return json(response, 409, { ok: false, error: "CONNECTOR_OFFLINE_OR_INVALID_OPERATION" });
        const requestId = connectors.requestOperation(operationMatch[1], socket, operation, body.input as Record<string, unknown> | undefined);
        return requestId ? json(response, 202, { ok: true, requestId }) : json(response, 403, { ok: false, error: "PERMISSION_DENIED" });
      }
      const taskCreateMatch = request.url?.match(/^\/v1\/connectors\/([^/]+)\/tasks$/);
      if (request.method === "POST" && taskCreateMatch) {
        const body = await requestBody(request);
        const socket = activeSockets.get(taskCreateMatch[1]);
        const operation = typeof body.operation === "string" ? body.operation as Parameters<ConnectorService["createTask"]>[1] : undefined;
        if (!socket || !operation) return json(response, 409, { ok: false, error: "CONNECTOR_OFFLINE_OR_INVALID_TASK" });
        const task = connectors.createTask(taskCreateMatch[1], operation, (body.input ?? {}) as Record<string, unknown>, Number(body.timeoutMs ?? 30_000));
        if (!task || !connectors.dispatchTask(task.taskId, socket)) return json(response, 403, { ok: false, error: "TASK_NOT_AUTHORIZED" });
        return json(response, 202, { ok: true, task });
      }
      const taskCancelMatch = request.url?.match(/^\/v1\/tasks\/([^/]+)\/cancel$/);
      if (request.method === "POST" && taskCancelMatch) {
        const task = connectors.getTask(taskCancelMatch[1]);
        const socket = task ? activeSockets.get(task.connectorId) : undefined;
        const ok = task ? connectors.cancelTask(task.taskId, task.connectorId, socket) : false;
        return json(response, ok ? 202 : 404, { ok, task: ok ? connectors.getTask(taskCancelMatch[1]) : null });
      }
      const taskRetryMatch = request.url?.match(/^\/v1\/tasks\/([^/]+)\/retry$/);
      if (request.method === "POST" && taskRetryMatch) {
        const task = connectors.getTask(taskRetryMatch[1]);
        const socket = task ? activeSockets.get(task.connectorId) : undefined;
        const ok = task ? connectors.retryTask(task.taskId, task.connectorId, socket) : false;
        return json(response, ok ? 202 : 409, { ok, task: ok ? connectors.getTask(taskRetryMatch[1]) : null });
      }
      const taskEventsMatch = request.url?.match(/^\/v1\/tasks\/([^/]+)\/events$/);
      if (request.method === "GET" && taskEventsMatch) return json(response, 200, { ok: true, events: database.listTaskEvents(taskEventsMatch[1]) });
      const taskStatusMatch = request.url?.match(/^\/v1\/tasks\/([^/]+)$/);
      if (request.method === "GET" && taskStatusMatch) {
        const task = connectors.getTask(taskStatusMatch[1]);
        return task ? json(response, 200, { ok: true, task }) : json(response, 404, { ok: false, error: "TASK_NOT_FOUND" });
      }
      const statusMatch = request.url?.match(/^\/v1\/connectors\/([^/]+)$/);
      if (request.method === "GET" && statusMatch) {
        const record = connectors.getConnector(statusMatch[1]);
        if (!record) return json(response, 404, { error: "CONNECTOR_NOT_FOUND" });
        const { accessToken: _accessToken, ...publicRecord } = record;
        return json(response, 200, publicRecord);
      }
      if (request.method === "POST" && request.url === "/v1/connectors/test-pairing") {
        const body = await requestBody(request);
        return json(response, 200, { ok: Boolean(body.pairingCode) });
      }
      return json(response, 404, { error: "NOT_FOUND" });
    } catch (error) {
      return json(response, 500, { error: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  const websocketServer = new WebSocketServer({ noServer: true });
  const workspaceWebSocketServer = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    if (request.url === "/events") {
      workspaceWebSocketServer.handleUpgrade(request, socket, head, (ws) => workspaceWebSocketServer.emit("connection", ws, request));
      return;
    }
    if (request.url !== "/connect") { socket.destroy(); return; }
    websocketServer.handleUpgrade(request, socket, head, (ws) => websocketServer.emit("connection", ws, request));
  });

  workspaceWebSocketServer.on("connection", (socket: WebSocket) => {
    workspaceSockets.add(socket);
    socket.send(JSON.stringify({ type: "events.ready" }));
    socket.on("close", () => workspaceSockets.delete(socket));
  });

  websocketServer.on("connection", (socket: WebSocket) => {
    sockets.add(socket);
    let connectorId: string | null = null;
    let authenticated = false;
    socket.on("message", (raw) => {
      try {
        const message = JSON.parse(String(raw)) as ConnectorMessage & { accessToken?: string };
        if (message.type === "pairing.request") {
          const accepted = connectors.pair(message as PairingRequest, socket);
          if (!accepted) { socket.close(4003, "Invalid or expired pairing code"); return; }
          connectorId = accepted.connectorId;
          activeSockets.set(connectorId, socket);
          socket.send(JSON.stringify(accepted));
          return;
        }
        if (message.type === "authenticate") {
          const auth = message as AuthenticateMessage;
          if (!connectorId || auth.connectorId !== connectorId || !connectors.authenticate(auth.connectorId, auth.accessToken)) {
            socket.close(4001, "Authentication failed");
            return;
          }
          authenticated = true;
          return;
        }
        if (message.type === "heartbeat") {
          if (!connectorId || !authenticated) { socket.close(4001, "Not authenticated"); return; }
          connectors.heartbeat(message as HeartbeatMessage);
          const current = connectors.getConnector(connectorId);
          if (current) socket.send(JSON.stringify({ type: "permissions.update", connectorId, permissions: current.permissions }));
          connectors.requestHealthCheck(message.connectorId, socket);
          return;
        }
        if (message.type === "operation.result") {
          if (!connectorId || !authenticated) { socket.close(4001, "Not authenticated"); return; }
          connectors.recordOperationResult(message as OperationResult, connectorId);
        }
        if (message.type === "task.progress") {
          if (!connectorId || !authenticated) { socket.close(4001, "Not authenticated"); return; }
          connectors.recordTaskProgress(message as TaskProgressMessage, connectorId);
        }
        if (message.type === "permissions.acknowledged") {
          if (!connectorId || !authenticated) { socket.close(4001, "Not authenticated"); return; }
          const acknowledgement = message as PermissionsAcknowledgedMessage;
          if (acknowledgement.connectorId === connectorId) connectors.acknowledgePermissions(connectorId, acknowledgement.permissions);
        }
      } catch { socket.close(4002, "Invalid message"); }
    });
    socket.on("close", () => {
      // Connection state is persisted by heartbeat and explicit revocation.
      // Do not query the database during shutdown after it has been closed.
      if (connectorId && activeSockets.get(connectorId) === socket) activeSockets.delete(connectorId);
      sockets.delete(socket);
    });

    (socket as WebSocket & { authenticate?: (token: string) => void }).authenticate = (token: string) => {
      if (connectorId && connectors.authenticate(connectorId, token)) authenticated = true;
    };
  });

  return {
    server,
    database,
    connectors,
    conversations,
    models,
    orchestrator,
    accounts,
    workspaceAccess,
    close: async () => new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (settled) return; settled = true; database.close(); resolve(); };
      const fallback = setTimeout(finish, 1_000);
      for (const socket of sockets) socket.terminate();
      for (const socket of workspaceSockets) socket.terminate();
      websocketServer.close();
      workspaceWebSocketServer.close();
      server.closeAllConnections?.();
      server.close(() => { clearTimeout(fallback); finish(); });
    }),
  };
}
