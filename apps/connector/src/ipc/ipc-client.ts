import { createConnection } from "node:net";

export async function sendIpc(request: Record<string, unknown>, socketPath = process.env.CONNECTOR_IPC_PATH ?? "./.data/connector/connector.sock"): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let body = "";
    socket.on("connect", () => socket.end(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => { body += String(chunk); });
    socket.on("end", () => { try { resolve(JSON.parse(body) as Record<string, unknown>); } catch (error) { reject(error); } });
    socket.on("error", reject);
  });
}
