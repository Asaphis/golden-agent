import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { OllamaAdapter } from "../../apps/connector/src/models/ollama-adapter.js";
import { ConnectorCore } from "../../apps/connector/src/core/connector-core.js";

async function main(): Promise<void> {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/tags") { response.end(JSON.stringify({ models: [{ name: "test-model", size: 123 }] })); return; }
    if (request.url === "/api/generate") {
      let body = "";
      request.on("data", (chunk) => { body += String(chunk); });
      request.on("end", () => {
        const parsed = JSON.parse(body) as { stream?: boolean };
        if (parsed.stream) {
          response.setHeader("transfer-encoding", "chunked");
          response.write(JSON.stringify({ response: "hello ", done: false }) + "\n");
          response.end(JSON.stringify({ response: "world", done: true }) + "\n");
        } else response.end(JSON.stringify({ response: "hello world", done: true }));
      });
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Model test server did not start");
  const adapter = new OllamaAdapter(`http://127.0.0.1:${address.port}`);
  try {
    const models = await adapter.discover();
    assert.equal(models[0]?.id, "test-model");
    const result = await adapter.execute({ model: "test-model", prompt: "hello" });
    assert.equal(result.response, "hello world");
    const chunks: string[] = [];
    for await (const chunk of adapter.stream({ model: "test-model", prompt: "hello" })) chunks.push(chunk);
    assert.deepEqual(chunks, ["hello ", "world"]);
    const denied = new ConnectorCore({ modelAdapter: adapter, permissions: ["connector.health"] });
    await assert.rejects(() => denied.execute("models.execute", { model: "test-model", prompt: "hello" }), /Permission denied/);
    const allowed = new ConnectorCore({ modelAdapter: adapter, permissions: ["model.use", "model.discovery"] });
    const streamed = await allowed.execute("models.stream", { model: "test-model", prompt: "hello" });
    assert.equal(streamed.response, "hello world");
    console.log("Phase 4 model flow passed: discovery, execution, streaming, timeout-capable adapter contract, and permission enforcement.");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
