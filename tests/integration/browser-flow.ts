import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { ConnectorCore } from "../../apps/connector/src/core/connector-core.js";

async function main(): Promise<void> {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end('<html><head><title>Test page</title></head><body><h1>Hello browser</h1><input id="name"><button id="go" onclick="document.querySelector(\'h1\').textContent=\'Clicked\'">Go</button><a href="/next">Next</a></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Browser test server did not start");
  const url = `http://127.0.0.1:${address.port}/`;
  try {
    const denied = new ConnectorCore({ permissions: ["connector.health"] });
    await assert.rejects(() => denied.execute("browser.open"), /Permission denied/);
    const core = new ConnectorCore({ permissions: ["browser.use"] });
    const opened = await core.execute("browser.open");
    assert.equal(typeof opened.sessionId, "string");
    const page = await core.execute("browser.navigate", { sessionId: opened.sessionId, url });
    assert.equal(page.title, "Test page");
    assert.equal(String(page.text).includes("Hello browser"), true);
    assert.equal(Array.isArray(page.links), true);
    const inspected = await core.execute("browser.inspect", { sessionId: opened.sessionId });
    assert.equal(inspected.url, page.url);
    const typed = await core.execute("browser.type", { sessionId: opened.sessionId, selector: "#name", text: "Golden Agent" });
    assert.equal(typed.characters, 12);
    await core.execute("browser.click", { sessionId: opened.sessionId, selector: "#go" });
    const screenshot = await core.execute("browser.screenshot", { sessionId: opened.sessionId });
    assert.equal(screenshot.mimeType, "image/png");
    assert.equal(typeof screenshot.base64, "string");
    const closed = await core.execute("browser.close", { sessionId: opened.sessionId });
    assert.equal(closed.closed, true);
    await assert.rejects(() => core.execute("browser.inspect", { sessionId: opened.sessionId }), /not found/);
    console.log("Phase 5 browser flow passed: permission enforcement, session lifecycle, navigation, inspection, screenshots, click/type interactions, and cleanup.");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
