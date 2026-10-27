# Phase 2 security hardening

Phase 2 hardens the connector/backend trust boundary.

Implemented controls:

- Connector access tokens expire after thirty days.
- Token rotation replaces the stored hash and invalidates the previous token.
- Rotated active sessions are closed so the connector reconnects with the new token.
- Revoked active sessions are terminated and revoked tokens cannot authenticate.
- Permission changes are acknowledged by the connector after local application.
- HTTP request bodies are limited to one megabyte.
- Backend requests are rate-limited per remote address.
- Local IPC requests require the installation secret and a unique nonce.
- Replayed IPC nonces are rejected.
- IPC requests larger than one megabyte are rejected.
- Filesystem paths are checked after canonical resolution to prevent symlink escapes.
- Terminal child processes receive a restricted environment rather than host secrets.

The security integration flow verifies token rotation, revocation, symlink escape rejection, IPC replay protection, and IPC size limits. Existing connector and Phase 1 task lifecycle tests also pass after these changes.
