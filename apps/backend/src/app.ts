import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { Database } from "./database/database.js";
import { ConnectorService } from "./modules/connectors/connector.service.js";
import type { AuthenticateMessage, ConnectorMessage, HeartbeatMessage, OperationResult, PairingRequest } from "../../../packages/protocol/src/index.js";

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
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") return json(response, 200, { ok: true, service: "golden-agent-backend" });
      if (request.method === "POST" && request.url === "/v1/connectors/pairing") return json(response, 201, connectors.createPairing());
      const revokeMatch = request.url?.match(/^\/v1\/connectors\/([^/]+)\/revoke$/);
      if (request.method === "POST" && revokeMatch) {
        const ok = connectors.revoke(revokeMatch[1]);
        return json(response, ok ? 200 : 404, { ok });
      }
      const statusMatch = request.url?.match(/^\/v1\/connectors\/([^/]+)$/);
      if (request.method === "GET" && statusMatch) {
        const record = connectors.getConnector(statusMatch[1]);
        return record ? json(response, 200, record) : json(response, 404, { error: "CONNECTOR_NOT_FOUND" });
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
    let connectorId: string | null = null;
    let authenticated = false;
    socket.on("message", (raw) => {
      try {
        const message = JSON.parse(String(raw)) as ConnectorMessage & { accessToken?: string };
        if (message.type === "pairing.request") {
          const accepted = connectors.pair(message as PairingRequest, socket);
          if (!accepted) { socket.close(4003, "Invalid or expired pairing code"); return; }
          connectorId = accepted.connectorId;
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
          connectors.requestHealthCheck(message.connectorId, socket);
          return;
        }
        if (message.type === "operation.result") {
          if (!connectorId || !authenticated) { socket.close(4001, "Not authenticated"); return; }
          connectors.recordOperationResult(message as OperationResult, connectorId);
        }
      } catch { socket.close(4002, "Invalid message"); }
    });
    socket.on("close", () => {
      // Connection state is persisted by heartbeat and explicit revocation.
      // Do not query the database during shutdown after it has been closed.
    });

    (socket as WebSocket & { authenticate?: (token: string) => void }).authenticate = (token: string) => {
      if (connectorId && connectors.authenticate(connectorId, token)) authenticated = true;
    };
  });

  return {
    server,
    database,
    connectors,
    close: async () => new Promise((resolve) => server.close(() => { database.close(); resolve(); })),
  };
}
