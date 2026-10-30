import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackendApp } from "../../apps/backend/src/app.js";
import { ConnectorClient } from "../../apps/connector/src/connection/client.js";
import { ConnectorCore } from "../../apps/connector/src/core/connector-core.js";

async function waitFor<T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 5_000): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for task state");
}

async function main(): Promise<void> {
  const app = createBackendApp(join(tmpdir(), `golden-agent-task-${Date.now()}.sqlite`));
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Task test server did not start");
  const httpUrl = `http://127.0.0.1:${address.port}`;
  const serverUrl = `ws://127.0.0.1:${address.port}/connect`;
  let connector: ConnectorClient | undefined;
  try {
    const pairing = await (await fetch(`${httpUrl}/v1/connectors/pairing`, { method: "POST" })).json() as { pairingCode: string };
    connector = new ConnectorClient({ serverUrl, pairingCode: pairing.pairingCode, core: new ConnectorCore({ permissions: ["connector.health"] }) });
    await connector.start();
    const identity = JSON.parse(readFileSync("./.data/connector/identity.json", "utf8")) as { connectorId: string };
    const create = await fetch(`${httpUrl}/v1/connectors/${identity.connectorId}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "health.check", timeoutMs: 5_000 }) });
    assert.equal(create.status, 202);
    const created = await create.json() as { task: { taskId: string; status: string } };
    assert.equal(["queued", "running"].includes(created.task.status), true);
    const completed = await waitFor(async () => await (await fetch(`${httpUrl}/v1/tasks/${created.task.taskId}`)).json() as { task: { status: string; progress: number; result?: Record<string, unknown> } }, (value) => value.task.status === "succeeded");
    assert.equal(completed.task.progress, 100);
    assert.equal(completed.task.result?.healthy, true);

    const cancelCreate = await fetch(`${httpUrl}/v1/connectors/${identity.connectorId}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "health.check", input: { delayMs: 2_000 }, timeoutMs: 5_000 }) });
    const cancelTask = await cancelCreate.json() as { task: { taskId: string } };
    const cancel = await fetch(`${httpUrl}/v1/tasks/${cancelTask.task.taskId}/cancel`, { method: "POST" });
    assert.equal(cancel.status, 202);
    const cancelled = await (await fetch(`${httpUrl}/v1/tasks/${cancelTask.task.taskId}`)).json() as { task: { status: string } };
    assert.equal(cancelled.task.status, "cancelled");
    const retry = await fetch(`${httpUrl}/v1/tasks/${cancelTask.task.taskId}/retry`, { method: "POST" });
    assert.equal(retry.status, 202);
    const retried = await waitFor(async () => await (await fetch(`${httpUrl}/v1/tasks/${cancelTask.task.taskId}`)).json() as { task: { status: string; attempts: number } }, (value) => value.task.status === "succeeded");
    assert.equal(retried.task.attempts, 2);
    console.log("Phase 1 task lifecycle passed: create, dispatch, progress, persisted completion, status retrieval, and cancellation.");
  } finally {
    connector?.stop();
    await app.close();
  }
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
