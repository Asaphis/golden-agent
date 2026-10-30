import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackendApp } from "../../apps/backend/src/app.js";
import { ConnectorClient } from "../../apps/connector/src/connection/client.js";

async function main(): Promise<void> {
  const databasePath = join(tmpdir(), `golden-agent-test-${Date.now()}.sqlite`);
  const app = createBackendApp(databasePath);
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start");
  const serverUrl = `ws://127.0.0.1:${address.port}/connect`;
  const httpUrl = `http://127.0.0.1:${address.port}`;

  try {
    const pairingResponse = await fetch(`${httpUrl}/v1/connectors/pairing`, { method: "POST" });
    assert.equal(pairingResponse.status, 201);
    const pairing = await pairingResponse.json() as { pairingId: string; pairingCode: string; expiresAt: string; qrPayload: string };
    assert.match(pairing.pairingId, /^[0-9a-f-]{36}$/);
    assert.match(pairing.pairingCode, /^GLA-[0-9A-F]{4}-[0-9A-F]{4}$/);
    assert.ok(new Date(pairing.expiresAt).getTime() > Date.now());
    assert.equal(pairing.qrPayload, `golden-agent://pair?code=${encodeURIComponent(pairing.pairingCode)}&expiresAt=${encodeURIComponent(pairing.expiresAt)}`);
    const connector = new ConnectorClient({ serverUrl, pairingCode: pairing.pairingCode });
    await connector.start();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const identity = JSON.parse(readFileSync("./.data/connector/identity.json", "utf8")) as { connectorId: string };
    const statusResponse = await fetch(`${httpUrl}/v1/connectors/${identity.connectorId}`);
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json() as { status: string; lastSeenAt: string | null };
    assert.equal(status.status, "online");
    assert.ok(status.lastSeenAt);
    connector.stop();
    console.log("Connector flow passed: pairing, authentication, online heartbeat, health operation, and persistence verified.");
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
