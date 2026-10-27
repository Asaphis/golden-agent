import { strict as assert } from "node:assert";
import { createBackendApp } from "../../apps/backend/src/app.js";
import { ConnectorServiceRuntime } from "../../apps/connector/src/service/service-runtime.js";
import { sendIpc } from "../../apps/connector/src/ipc/ipc-client.js";

async function main(): Promise<void> {
  const app = createBackendApp(`/tmp/golden-agent-service-${Date.now()}.sqlite`);
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Backend did not start");
  process.env.CONNECTOR_SERVER_URL = `ws://127.0.0.1:${address.port}/connect`;
  const pairing = await (await fetch(`http://127.0.0.1:${address.port}/v1/connectors/pairing`, { method: "POST" })).json() as { pairingCode: string };
  const runtime = new ConnectorServiceRuntime(pairing.pairingCode);
  try {
    await runtime.start();
    const status = await sendIpc({ action: "status" });
    assert.equal(status.ok, true);
    const capabilities = await sendIpc({ action: "capabilities" });
    assert.equal(capabilities.ok, true);
    const health = await sendIpc({ action: "execute", operation: "health.check" });
    assert.equal(health.ok, true);
    console.log("Connector service flow passed: background runtime, local IPC, capabilities, and core operation verified.");
  } finally {
    await runtime.stop();
    await app.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
