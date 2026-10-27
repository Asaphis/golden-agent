import { createBackendApp } from "./app.js";

const host = process.env.BACKEND_HOST ?? "127.0.0.1";
const port = Number(process.env.BACKEND_PORT ?? 4100);
const app = createBackendApp();

app.server.listen(port, host, () => {
  console.log(`Golden Agent backend listening on http://${host}:${port}`);
  console.log(`Connector WebSocket endpoint: ws://${host}:${port}/connect`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
