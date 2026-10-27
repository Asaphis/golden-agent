import { readFileSync } from "node:fs";
import { createPairingCode } from "./pairing/pairing-client.js";
import { sendIpc } from "./ipc/ipc-client.js";
import { ConnectorServiceRuntime } from "./service/service-runtime.js";
import { log } from "./observability/logger.js";

const args = process.argv.slice(2);
const command = args[0] ?? "start";
const pairingCodeIndex = args.indexOf("--pairing-code");
const pairingCode = pairingCodeIndex >= 0 ? args[pairingCodeIndex + 1] : process.env.GOLDEN_AGENT_PAIRING_CODE;

if (command === "pair") {
  createPairingCode().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
} else if (command === "status") {
  sendIpc({ action: "status" }).then((result) => console.log(JSON.stringify(result, null, 2))).catch(() => {
    try { console.log(readFileSync(process.env.CONNECTOR_IDENTITY_PATH ?? "./.data/connector/identity.json", "utf8")); }
    catch { console.log("Connector service is not running and no identity exists."); }
  });
} else if (command === "capabilities") {
  sendIpc({ action: "capabilities" }).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
} else if (command === "start" || command === "service") {
  const runtime = new ConnectorServiceRuntime(pairingCode);
  let stopping = false;
  const shutdown = (code: number) => { if (stopping) return; stopping = true; runtime.stop().catch((error) => log("error", "service.stop_failed", { error: error instanceof Error ? error.message : String(error) })).finally(() => process.exit(code)); };
  runtime.start().then(() => log("info", "service.running")).catch((error) => { log("error", "service.start_failed", { error: error instanceof Error ? error.message : String(error) }); shutdown(1); });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => shutdown(0));
  process.on("uncaughtException", (error) => { log("error", "process.uncaught_exception", { error: error.message, stack: error.stack }); shutdown(1); });
  process.on("unhandledRejection", (reason) => { log("error", "process.unhandled_rejection", { reason: String(reason) }); shutdown(1); });
} else {
  console.error(`Unknown command: ${command}. Use pair, start, service, status, or capabilities.`);
  process.exitCode = 1;
}
