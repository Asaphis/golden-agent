import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";

function defaultIpcSecretPath(): string {
  if (process.platform === "win32") return join(process.env.APPDATA ?? process.cwd(), "GoldenAgent", "ipc-secret");
  return "./.data/connector/ipc-secret";
}

export function loadOrCreateIpcSecret(filePath = process.env.CONNECTOR_IPC_SECRET_PATH ?? defaultIpcSecretPath()): string {
  const path = resolve(filePath);
  try { return readFileSync(path, "utf8").trim(); } catch { /* create below */ }
  const secret = randomBytes(32).toString("hex");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, secret, { mode: 0o600 });
  return secret;
}
