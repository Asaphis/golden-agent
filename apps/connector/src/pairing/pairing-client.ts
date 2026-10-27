export async function createPairingCode(httpServerUrl = process.env.CONNECTOR_HTTP_URL ?? "http://127.0.0.1:4100"): Promise<void> {
  const response = await fetch(`${httpServerUrl}/v1/connectors/pairing`, { method: "POST" });
  if (!response.ok) throw new Error(`Backend pairing request failed with HTTP ${response.status}`);
  const body = await response.json() as { pairingCode: string; expiresAt: string };
  console.log(`Pairing code: ${body.pairingCode}`);
  console.log(`Expires: ${body.expiresAt}`);
  console.log(`Start the connector with: pnpm dev:connector start --pairing-code ${body.pairingCode}`);
}
