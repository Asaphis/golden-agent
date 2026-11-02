import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createBackendApp } from "../../apps/backend/src/app.js";

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "golden-agent-workspace-"));
  const app = createBackendApp(join(root, "backend.sqlite"));
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Workspace test server did not start");
  const base = `http://127.0.0.1:${address.port}`;
  const ollama = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/tags") { response.end(JSON.stringify({ models: [{ name: "gateway-model" }] })); return; }
    if (request.url === "/api/generate") {
      let body = "";
      request.on("data", (chunk) => { body += String(chunk); });
      request.on("end", () => {
        const input = JSON.parse(body) as { stream?: boolean };
        if (input.stream) { response.setHeader("transfer-encoding", "chunked"); response.write(JSON.stringify({ response: "gateway ", done: false }) + "\n"); response.end(JSON.stringify({ response: "ok", done: true }) + "\n"); }
        else response.end(JSON.stringify({ response: "gateway ok", done: true }));
      });
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => ollama.listen(0, "127.0.0.1", resolve));
  const ollamaAddress = ollama.address();
  if (!ollamaAddress || typeof ollamaAddress === "string") throw new Error("Mock Ollama did not start");
  const ollamaUrl = `http://127.0.0.1:${ollamaAddress.port}`;
  try {
    const registered = await (await fetch(`${base}/v1/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "workspace-owner@example.com", password: "workspace owner password" }) })).json() as { token: string; user: { userId: string } };
    const authHeaders = { authorization: `Bearer ${registered.token}`, "content-type": "application/json" };
    const created = await (await fetch(`${base}/v1/conversations`, { method: "POST", headers: authHeaders, body: JSON.stringify({ title: "Workspace foundation" }) })).json() as { conversation: { conversationId: string } };
    assert.ok(created.conversation.conversationId);
    const message = await (await fetch(`${base}/v1/conversations/${created.conversation.conversationId}/messages`, { method: "POST", headers: authHeaders, body: JSON.stringify({ role: "user", content: "Hello Golden Agent" }) })).json() as { message: { content: string } };
    assert.equal(message.message.content, "Hello Golden Agent");
    const detail = await (await fetch(`${base}/v1/conversations/${created.conversation.conversationId}`, { headers: authHeaders })).json() as { messages: Array<{ role: string }> };
    assert.equal(detail.messages.length, 1);
    const provider = await (await fetch(`${base}/v1/providers`, { method: "POST", headers: authHeaders, body: JSON.stringify({ name: "Local Ollama", type: "ollama", config: { baseUrl: ollamaUrl } }) })).json() as { provider: { providerId: string } };
    const model = await (await fetch(`${base}/v1/models`, { method: "POST", headers: authHeaders, body: JSON.stringify({ providerId: provider.provider.providerId, externalId: "llama3.2", capabilities: ["text", "streaming"] }) })).json() as { model: { modelId: string; externalId: string } };
    assert.equal(model.model.externalId, "llama3.2");
    const executed = await (await fetch(`${base}/v1/models/${model.model.modelId}/execute`, { method: "POST", headers: authHeaders, body: JSON.stringify({ prompt: "hello" }) })).json() as { result: { response: string } };
    assert.equal(executed.result.response, "gateway ok");
    const streamed = await (await fetch(`${base}/v1/models/${model.model.modelId}/stream`, { method: "POST", headers: authHeaders, body: JSON.stringify({ prompt: "hello" }) })).text();
    assert.match(streamed, /gateway/);
    const discovered = await (await fetch(`${base}/v1/providers/${provider.provider.providerId}/discover`, { method: "POST", headers: authHeaders })).json() as { models: Array<{ id: string }> };
    assert.equal(discovered.models[0]?.id, "gateway-model");
    const responseText = await (await fetch(`${base}/v1/conversations/${created.conversation.conversationId}/respond`, { method: "POST", headers: authHeaders, body: JSON.stringify({ modelId: model.model.modelId, content: "Use the model gateway" }) })).text();
    const responseEvents = responseText.trim().split("\n").map((line) => JSON.parse(line) as { type: string; chunk?: string });
    assert.equal(responseEvents[0]?.type, "user.message");
    assert.equal(responseEvents.filter((event) => event.type === "assistant.chunk").map((event) => event.chunk ?? "").join(""), "gateway ok");
    assert.equal(responseEvents.at(-1)?.type, "assistant.done");
    const respondedDetail = await (await fetch(`${base}/v1/conversations/${created.conversation.conversationId}`, { headers: authHeaders })).json() as { messages: Array<{ role: string; content: string }> };
    assert.equal(respondedDetail.messages.at(-1)?.role, "assistant");
    assert.equal(respondedDetail.messages.at(-1)?.content, "gateway ok");
    const connectorId = randomUUID();
    app.database.createConnector({ connectorId, deviceId: randomUUID(), deviceName: "Workspace test connector", platform: "linux", status: "online", accessToken: null, tokenExpiresAt: null, permissions: ["connector.health"], capabilities: ["system.info", "terminal.execute"], lastSeenAt: new Date().toISOString(), ownerUserId: registered.user.userId, workspaceId: "default" });
    const devices = await (await fetch(`${base}/v1/connectors`, { headers: authHeaders })).json() as { connectors: Array<{ connectorId: string; capabilities: string[] }> };
    assert.equal(devices.connectors.find((device) => device.connectorId === connectorId)?.capabilities[0], "system.info");
    const healthTask = app.connectors.createTask(connectorId, "health.check");
    assert.ok(healthTask);
    const taskEvents = await (await fetch(`${base}/v1/tasks/${healthTask.taskId}/events`, { headers: authHeaders })).json() as { events: Array<{ type: string }> };
    assert.equal(taskEvents.events[0]?.type, "task.created");
    const taskRequest = await (await fetch(`${base}/v1/tasks`, { method: "POST", headers: authHeaders, body: JSON.stringify({ connectorId, operation: "terminal.execute", input: { command: "pwd" } }) })).json() as { status: string; permissionRequest: { requestId: string; permission: string } };
    assert.equal(taskRequest.status, "permission_required");
    assert.equal(taskRequest.permissionRequest.permission, "terminal.execute");
    const resolved = await (await fetch(`${base}/v1/permission-requests/${taskRequest.permissionRequest.requestId}/resolve`, { method: "POST", headers: authHeaders, body: JSON.stringify({ approved: true, resolvedBy: "integration-test" }) })).json() as { request: { status: string } };
    assert.equal(resolved.request.status, "approved");
    assert.ok(app.database.getConnector(connectorId)?.permissions.includes("terminal.execute"));
    console.log("Workspace backend flow passed: conversations, messages, model gateway streaming, providers, models, and persistence APIs verified.");
  } finally {
    await new Promise<void>((resolve) => ollama.close(() => resolve()));
    await app.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
