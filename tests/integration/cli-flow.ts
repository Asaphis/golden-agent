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
    const permissions = await execFileAsync(process.execPath, ["dist/apps/connector/src/main.js", "permissions", "set", "--json", "--permissions", "connector.health,filesystem.read"], { env });
    assert.deepEqual(JSON.parse(permissions.stdout).permissions, ["connector.health", "filesystem.read"]);

    const invalidPermission = await expectFailure(["permissions", "set", "--json", "--permissions", "not-a-permission"], env);
    assert.equal(JSON.parse(invalidPermission).error, "INVALID_PERMISSION");
    const invalidCommand = await expectFailure(["not-a-command", "--json"], env);
    assert.match(JSON.parse(invalidCommand).error, /Unknown command/);
    const wrongSecret = await expectFailure(["status", "--json"], { ...env, CONNECTOR_IPC_SECRET_PATH: join(directory, "wrong-secret") });
    assert.equal(JSON.parse(wrongSecret).error, "IPC_AUTHENTICATION_FAILED");
    await server.stop();
    const serviceEnv = { ...env, CONNECTOR_PID_PATH: join(directory, "connector.pid"), CONNECTOR_DATA_PATH: join(directory, "service-data"), CONNECTOR_SERVER_URL: "ws://127.0.0.1:9/connect" };
    const serviceStart = await execFileAsync(process.execPath, ["dist/apps/connector/src/main.js", "service", "start", "--json"], { env: serviceEnv });
    assert.equal(JSON.parse(serviceStart.stdout).ok, true);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    const serviceStatus = await execFileAsync(process.execPath, ["dist/apps/connector/src/main.js", "service", "status", "--json"], { env: serviceEnv });
    assert.equal(typeof JSON.parse(serviceStatus.stdout).running, "boolean");
    await execFileAsync(process.execPath, ["dist/apps/connector/src/main.js", "service", "stop", "--json"], { env: serviceEnv });
    const stoppedStatus = await execFileAsync(process.execPath, ["dist/apps/connector/src/main.js", "service", "status", "--json"], { env: serviceEnv });
    assert.equal(JSON.parse(stoppedStatus.stdout).running, false);
    console.log("CLI flow passed: JSON output, permissions, invalid input, authentication failure, diagnostics, and service lifecycle verified.");
  } finally {
    await server.stop();
    await core.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}

async function expectFailure(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  try {
    await execFileAsync(process.execPath, ["dist/apps/connector/src/main.js", ...args], { env });
  } catch (error) {
    const result = error as { stdout?: string; stderr?: string };
    return result.stdout ?? result.stderr ?? "";
  }
  throw new Error(`Expected CLI command to fail: ${args.join(" ")}`);
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
