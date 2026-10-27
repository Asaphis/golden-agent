import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";

export function loadOrCreateIpcSecret(filePath = process.env.CONNECTOR_IPC_SECRET_PATH ?? "./.data/connector/ipc-secret"): string {
  const path = resolve(filePath);
  try { return readFileSync(path, "utf8").trim(); } catch { /* create below */ }
  const secret = randomBytes(32).toString("hex");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, secret, { mode: 0o600 });
  return secret;
}
