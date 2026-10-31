import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackendApp } from "../../apps/backend/src/app.js";

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "golden-agent-workspace-"));
  const app = createBackendApp(join(root, "backend.sqlite"));
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Workspace test server did not start");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const created = await (await fetch(`${base}/v1/conversations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Workspace foundation" }) })).json() as { conversation: { conversationId: string } };
    assert.ok(created.conversation.conversationId);
    const message = await (await fetch(`${base}/v1/conversations/${created.conversation.conversationId}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "user", content: "Hello Golden Agent" }) })).json() as { message: { content: string } };
    assert.equal(message.message.content, "Hello Golden Agent");
    const detail = await (await fetch(`${base}/v1/conversations/${created.conversation.conversationId}`)).json() as { messages: Array<{ role: string }> };
    assert.equal(detail.messages.length, 1);
    const provider = await (await fetch(`${base}/v1/providers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Local Ollama", type: "ollama" }) })).json() as { provider: { providerId: string } };
    const model = await (await fetch(`${base}/v1/models`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ providerId: provider.provider.providerId, externalId: "llama3.2", capabilities: ["text", "streaming"] }) })).json() as { model: { externalId: string } };
    assert.equal(model.model.externalId, "llama3.2");
    const connectorId = randomUUID();
    app.database.createConnector({ connectorId, deviceId: randomUUID(), deviceName: "Workspace test connector", platform: "linux", status: "online", accessToken: null, tokenExpiresAt: null, permissions: ["connector.health"], capabilities: ["system.info", "terminal.execute"], lastSeenAt: new Date().toISOString() });
    const devices = await (await fetch(`${base}/v1/connectors`)).json() as { connectors: Array<{ connectorId: string; capabilities: string[] }> };
    assert.equal(devices.connectors.find((device) => device.connectorId === connectorId)?.capabilities[0], "system.info");
    const healthTask = app.connectors.createTask(connectorId, "health.check");
    assert.ok(healthTask);
    const taskEvents = await (await fetch(`${base}/v1/tasks/${healthTask.taskId}/events`)).json() as { events: Array<{ type: string }> };
    assert.equal(taskEvents.events[0]?.type, "task.created");
    const taskRequest = await (await fetch(`${base}/v1/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ connectorId, operation: "terminal.execute", input: { command: "pwd" } }) })).json() as { status: string; permissionRequest: { requestId: string; permission: string } };
    assert.equal(taskRequest.status, "permission_required");
    assert.equal(taskRequest.permissionRequest.permission, "terminal.execute");
    const resolved = await (await fetch(`${base}/v1/permission-requests/${taskRequest.permissionRequest.requestId}/resolve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approved: true, resolvedBy: "integration-test" }) })).json() as { request: { status: string } };
    assert.equal(resolved.request.status, "approved");
    assert.ok(app.database.getConnector(connectorId)?.permissions.includes("terminal.execute"));
    console.log("Workspace backend flow passed: conversations, messages, providers, models, and persistence APIs verified.");
  } finally {
    await app.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
