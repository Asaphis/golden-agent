import { createConnection } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

async function main(): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "golden-agent-ipc-tcp-"));
  process.env.CONNECTOR_IPC_SECRET_PATH = join(dataDir, "ipc-secret");

  const { ConnectorCore } = await import("../../apps/connector/src/core/connector-core.js");
  const { IpcServer } = await import("../../apps/connector/src/ipc/ipc-server.js");

  const core = new ConnectorCore({ permissions: ["connector.health"] });
  const server = new IpcServer({ transport: "tcp", host: "127.0.0.1", port: 43101, core, getStatus: () => ({ ready: true, connected: true }) });
  await server.start();

  function request(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(43101, "127.0.0.1");
      let body = "";
      socket.once("error", reject);
      socket.on("data", (chunk) => { body += String(chunk); });
      socket.on("end", () => {
        try { resolve(JSON.parse(body) as Record<string, unknown>); }
        catch (error) { reject(error); }
      });
      socket.on("connect", () => socket.end(`${JSON.stringify(payload)}\n`));
    });
  }

  try {
    const secret = await readFile(process.env.CONNECTOR_IPC_SECRET_PATH, "utf8");
    const nonce = randomUUID();
    const status = await request({ auth: secret.trim(), nonce, action: "status" });
    if (status.ok !== true || !(status.status as Record<string, unknown>)?.connected) throw new Error("TCP status request failed");

    const capabilities = await request({ auth: secret.trim(), nonce: randomUUID(), action: "capabilities" });
    if (capabilities.ok !== true || !Array.isArray(capabilities.capabilities)) throw new Error("TCP capabilities request failed");

    const unauthenticated = await request({ auth: "wrong", nonce: randomUUID(), action: "status" });
    if (unauthenticated.error !== "IPC_AUTHENTICATION_FAILED") throw new Error("TCP authentication failure was not rejected");

    const replay = await request({ auth: secret.trim(), nonce, action: "status" });
    if (replay.error !== "IPC_REPLAY_DETECTED") throw new Error("TCP nonce replay was not rejected");

    console.log("TCP IPC flow passed: authenticated status, capabilities, rejection, and replay protection verified.");
  } finally {
    await server.stop();
    await core.dispose();
    await rm(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
