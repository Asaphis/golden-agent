import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ConnectorServiceRuntime } from "./service/service-runtime.js";
import { log } from "./observability/logger.js";

function loadWindowsConfig(): void {
  if (process.platform !== "win32") return;
  const configPath = process.env.CONNECTOR_CONFIG_PATH ?? join(process.env.APPDATA ?? process.cwd(), "GoldenAgent", "connector.env");
  try {
    for (const line of readFileSync(configPath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch { /* A missing config is valid for interactive development. */ }
}

loadWindowsConfig();

const args = process.argv.slice(2);
const command = args[0] ?? "start";
const pairingCodeIndex = args.indexOf("--pairing-code");
const pairingCode = pairingCodeIndex >= 0 ? args[pairingCodeIndex + 1] : process.env.GOLDEN_AGENT_PAIRING_CODE;
const serviceControl = command === "service" && ["start", "stop", "restart", "status"].includes(args[1] ?? "");

if ((command !== "start" && command !== "service") || serviceControl) {
  void import("./cli.js");
} else if (command === "start" || command === "service") {
  const runtime = new ConnectorServiceRuntime(pairingCode);
  let stopping = false;
  const shutdown = (code: number) => { if (stopping) return; stopping = true; runtime.stop().catch((error) => log("error", "service.stop_failed", { error: error instanceof Error ? error.message : String(error) })).finally(() => process.exit(code)); };
  runtime.start().then(() => log("info", "service.running")).catch((error) => { log("error", "service.start_failed", { error: error instanceof Error ? error.message : String(error) }); shutdown(1); });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => shutdown(0));
  process.on("uncaughtException", (error) => { log("error", "process.uncaught_exception", { error: error.message, stack: error.stack }); shutdown(1); });
  process.on("unhandledRejection", (reason) => { log("error", "process.unhandled_rejection", { reason: String(reason) }); shutdown(1); });
}
