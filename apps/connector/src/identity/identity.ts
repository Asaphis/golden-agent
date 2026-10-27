import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export interface ConnectorIdentity {
  connectorId: string;
  deviceName: string;
  platform: string;
}

const identityPath = () => resolve(process.env.CONNECTOR_IDENTITY_PATH ?? "./.data/connector/identity.json");
const tokenPath = () => resolve(process.env.CONNECTOR_TOKEN_PATH ?? "./.data/connector/access-token");

export function loadOrCreateIdentity(filePath = identityPath()): ConnectorIdentity {
  const path = resolve(filePath);
  try { return JSON.parse(readFileSync(path, "utf8")) as ConnectorIdentity; } catch { /* create below */ }
  const identity: ConnectorIdentity = { connectorId: randomUUID(), deviceName: `${process.platform}-connector`, platform: `${process.platform}-${process.arch}` };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(identity, null, 2), { mode: 0o600 });
  return identity;
}

export function saveAccessToken(token: string, filePath = tokenPath()): void {
  const path = resolve(filePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, token, { mode: 0o600 });
}

export function loadAccessToken(filePath = tokenPath()): string | null {
  try { return readFileSync(resolve(filePath), "utf8").trim() || null; } catch { return null; }
}
