import { createConnection, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { loadOrCreateIpcSecret } from "./ipc-auth.js";

export async function sendIpc(request: Record<string, unknown>, socketPath = process.env.CONNECTOR_IPC_PATH ?? "./.data/connector/connector.sock"): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket: Socket = process.platform === "win32"
      ? createConnection(Number(process.env.CONNECTOR_IPC_PORT ?? "4101"), process.env.CONNECTOR_IPC_HOST ?? "127.0.0.1")
      : createConnection(socketPath);
    let body = "";
    socket.on("connect", () => socket.end(`${JSON.stringify({ ...request, auth: loadOrCreateIpcSecret(), nonce: randomUUID() })}\n`));
    socket.on("data", (chunk) => { body += String(chunk); });
    socket.on("end", () => { try { resolve(JSON.parse(body) as Record<string, unknown>); } catch (error) { reject(error); } });
    socket.on("error", reject);
  });
}
