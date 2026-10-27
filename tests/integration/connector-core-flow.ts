import { strict as assert } from "node:assert";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectorCore } from "../../apps/connector/src/core/connector-core.js";

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "golden-agent-core-"));
  const file = join(root, "allowed.txt");
  const core = new ConnectorCore({
    allowedRoots: [root],
    permissions: ["connector.health", "filesystem.read", "filesystem.write", "process.manage", "terminal.execute", "model.discovery"],
    allowedTerminalCommands: ["node"],
  });

  await writeFile(file, "before", "utf8");
  const listed = await core.execute("filesystem.list", { path: root });
  assert.equal(Array.isArray(listed.entries), true);
  const read = await core.execute("filesystem.read", { path: file });
  assert.equal(read.content, "before");
  await core.execute("filesystem.write", { path: file, content: "after" });
  assert.equal(await readFile(file, "utf8"), "after");
  await assert.rejects(() => core.execute("filesystem.read", { path: join(root, "..", "outside.txt") }), /outside/);
  const processList = await core.execute("process.list");
  assert.equal(typeof processList.processes, "object");
  const terminal = await core.execute("terminal.execute", { command: "node", args: ["-e", "process.stdout.write('ok')"] });
  assert.equal(terminal.stdout, "ok");
  await assert.rejects(() => core.execute("terminal.execute", { command: "sh", args: ["-c", "echo unsafe"] }), /not allowlisted/);
  const models = await core.execute("models.discover");
  assert.equal(Array.isArray(models.models), true);
  core.updatePermissions(["connector.health"]);
  await assert.rejects(() => core.execute("filesystem.read", { path: file }), /Permission denied/);
  console.log("Connector core flow passed: filesystem safety, permissions, process listing, terminal allowlist, and model discovery.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
