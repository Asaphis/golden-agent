import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ConnectorCore } from "../../apps/connector/src/core/connector-core.js";
import { IpcServer } from "../../apps/connector/src/ipc/ipc-server.js";

const execFileAsync = promisify(execFile);

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "golden-agent-cli-"));
  const socketPath = join(directory, "connector.sock");
  const secretPath = join(directory, "ipc-secret");
  process.env.CONNECTOR_IPC_SECRET_PATH = secretPath;
  const core = new ConnectorCore({ permissions: ["connector.health", "model.discovery"] });
  const server = new IpcServer({ socketPath, transport: "unix", core, getStatus: () => ({ ready: true, connected: true, connectorId: "cli-test-connector", permissions: core.getPermissions() }) });
  await server.start();
  try {
    const env = { ...process.env, CONNECTOR_IPC_PATH: socketPath, CONNECTOR_IPC_SECRET_PATH: secretPath };
    const status = await execFileAsync(process.execPath, ["dist/apps/connector/src/main.js", "status", "--json"], { env });
    const statusPayload = JSON.parse(status.stdout) as { status: { connected: boolean; connectorId: string } };
    assert.equal(statusPayload.status.connected, true);
    assert.equal(statusPayload.status.connectorId, "cli-test-connector");
    const diagnostics = await execFileAsync(process.execPath, ["dist/apps/connector/src/main.js", "doctor", "--json"], { env });
    const diagnosticPayload = JSON.parse(diagnostics.stdout) as { diagnostics: { connected: boolean } };
    assert.equal(diagnosticPayload.diagnostics.connected, true);
    console.log("CLI flow passed: authenticated status and diagnostics JSON output verified.");
  } finally {
    await server.stop();
    await core.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
