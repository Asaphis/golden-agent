import { strict as assert } from "node:assert";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackendApp } from "../../apps/backend/src/app.js";

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "golden-agent-auth-"));
  const app = createBackendApp(join(root, "auth.sqlite"));
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Auth test server did not start");
  const base = `http://127.0.0.1:${address.port}`;
  const email = "owner@example.com";
  const password = "correct horse battery";
  try {
    const registered = await (await fetch(`${base}/v1/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, displayName: "Owner" }) })).json() as { token: string; user: { email: string }; session: { sessionId: string } };
    assert.equal(registered.user.email, email);
    assert.ok(registered.token);
    const me = await (await fetch(`${base}/v1/auth/me`, { headers: { authorization: `Bearer ${registered.token}` } })).json() as { user: { displayName: string } };
    assert.equal(me.user.displayName, "Owner");
    const login = await (await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) })).json() as { token: string; session: { sessionId: string } };
    assert.ok(login.token);
    assert.notEqual(login.session.sessionId, registered.session.sessionId);
    const sessions = await (await fetch(`${base}/v1/auth/sessions`, { headers: { authorization: `Bearer ${registered.token}` } })).json() as { sessions: Array<{ sessionId: string }> };
    assert.equal(sessions.sessions.length, 2);
    const revoked = await (await fetch(`${base}/v1/auth/sessions/${login.session.sessionId}/revoke`, { method: "POST", headers: { authorization: `Bearer ${registered.token}` } })).json() as { ok: boolean };
    assert.equal(revoked.ok, true);
    const invitedEmail = "member@example.com";
    const invited = await (await fetch(`${base}/v1/workspaces/default/invitations`, { method: "POST", headers: { authorization: `Bearer ${registered.token}`, "content-type": "application/json" }, body: JSON.stringify({ email: invitedEmail, role: "member" }) })).json() as { token: string };
    const member = await (await fetch(`${base}/v1/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: invitedEmail, password: "another correct password" }) })).json() as { token: string };
    const accepted = await (await fetch(`${base}/v1/workspace-invitations/accept`, { method: "POST", headers: { authorization: `Bearer ${member.token}`, "content-type": "application/json" }, body: JSON.stringify({ token: invited.token }) })).json() as { membership: { role: string } };
    assert.equal(accepted.membership.role, "member");
    const loggedOut = await (await fetch(`${base}/v1/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${registered.token}` } })).json() as { ok: boolean };
    assert.equal(loggedOut.ok, true);
    const denied = await fetch(`${base}/v1/auth/me`, { headers: { authorization: `Bearer ${registered.token}` } });
    assert.equal(denied.status, 401);
    console.log("Auth flow passed: registration, password login, identity, multiple sessions, revocation, and logout verified.");
  } finally {
    await app.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
