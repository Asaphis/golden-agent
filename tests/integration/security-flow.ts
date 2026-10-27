import { strict as assert } from "node:assert";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectorCore } from "../../apps/connector/src/core/connector-core.js";
import { IpcServer } from "../../apps/connector/src/ipc/ipc-server.js";
import { Database } from "../../apps/backend/src/database/database.js";
import { ConnectorService } from "../../apps/backend/src/modules/connectors/connector.service.js";

function raw(socketPath: string, body: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let output = "";
    socket.on("data", (chunk) => { output += String(chunk); });
    socket.on("end", () => { try { resolve(JSON.parse(output) as Record<string, unknown>); } catch (error) { reject(error); } });
    socket.on("error", reject);
    socket.on("connect", () => socket.end(body));
  });
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "golden-agent-security-"));
  const outside = await mkdtemp(join(tmpdir(), "golden-agent-outside-"));
  const outsideFile = join(outside, "secret.txt");
  await writeFile(outsideFile, "secret", "utf8");
  const link = join(root, "link.txt");
  await symlink(outsideFile, link);
  const core = new ConnectorCore({ allowedRoots: [root], permissions: ["connector.health", "filesystem.read"] });
  await assert.rejects(() => core.execute("filesystem.read", { path: link }), /outside|resolves/);

  const socketPath = join(root, "connector.sock");
  const secretPath = join(root, "ipc-secret");
  process.env.CONNECTOR_IPC_SECRET_PATH = secretPath;
  const server = new IpcServer({ socketPath, core, getStatus: () => ({ ok: true }) });
  await server.start();
  const secret = (await import("../../apps/connector/src/ipc/ipc-auth.js")).loadOrCreateIpcSecret(secretPath);
  const nonce = "security-test-nonce";
  const first = await raw(socketPath, `${JSON.stringify({ auth: secret, nonce, action: "status" })}\n`);
  assert.equal(first.ok, true);
  const replay = await raw(socketPath, `${JSON.stringify({ auth: secret, nonce, action: "status" })}\n`);
  assert.equal(replay.error, "IPC_REPLAY_DETECTED");
  const oversized = await raw(socketPath, `${"x".repeat(1_000_001)}\n`);
  assert.equal(oversized.error, "IPC_REQUEST_TOO_LARGE");
  await server.stop();
  const database = new Database(join(root, "security.sqlite"));
  const connectors = new ConnectorService(database);
  const pairing = connectors.createPairing();
  const connectorId = "security-test-connector";
  const accepted = connectors.pair({ type: "pairing.request", pairingCode: pairing.pairingCode, connectorId, deviceName: "security-test", platform: "test" }, {} as never);
  assert.ok(accepted);
  assert.equal(connectors.authenticate(connectorId, accepted.accessToken), true);
  const rotated = connectors.rotateToken(connectorId);
  assert.ok(rotated);
  assert.equal(connectors.authenticate(connectorId, accepted.accessToken), false);
  assert.equal(connectors.authenticate(connectorId, rotated.accessToken), true);
  assert.equal(connectors.revoke(connectorId), true);
  assert.equal(connectors.authenticate(connectorId, rotated.accessToken), false);
  database.close();
  console.log("Phase 2 security flow passed: token rotation, revocation, symlink escape rejection, IPC nonce replay protection, and IPC request limits.");
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
