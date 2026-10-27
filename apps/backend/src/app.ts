import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { Database } from "./database/database.js";
import { ConnectorService } from "./modules/connectors/connector.service.js";
import type { AuthenticateMessage, ConnectorMessage, HeartbeatMessage, OperationResult, PairingRequest, Permission, TaskProgressMessage } from "../../../packages/protocol/src/index.js";

export interface BackendApp {
  server: ReturnType<typeof createServer>;
  database: Database;
  connectors: ConnectorService;
  close(): Promise<void>;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function requestBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => { body += String(chunk); });
    request.on("end", () => {
      try { resolve(body ? JSON.parse(body) as Record<string, unknown> : {}); } catch (error) { reject(error); }
    });
    request.on("error", reject);
  });
}

export function createBackendApp(databasePath = process.env.DATABASE_PATH): BackendApp {
  const database = new Database(databasePath);
  const connectors = new ConnectorService(database);
  const activeSockets = new Map<string, WebSocket>();
  const sockets = new Set<WebSocket>();
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") return json(response, 200, { ok: true, service: "golden-agent-backend" });
      if (request.method === "POST" && request.url === "/v1/connectors/pairing") return json(response, 201, connectors.createPairing());
      const revokeMatch = request.url?.match(/^\/v1\/connectors\/([^/]+)\/revoke$/);
      if (request.method === "POST" && revokeMatch) {
        const ok = connectors.revoke(revokeMatch[1]);
        return json(response, ok ? 200 : 404, { ok });
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
  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/connect") { socket.destroy(); return; }
    websocketServer.handleUpgrade(request, socket, head, (ws) => websocketServer.emit("connection", ws, request));
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
    close: async () => new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (settled) return; settled = true; database.close(); resolve(); };
      const fallback = setTimeout(finish, 1_000);
      for (const socket of sockets) socket.terminate();
      websocketServer.close();
      server.closeAllConnections?.();
      server.close(() => { clearTimeout(fallback); finish(); });
    }),
  };
}
