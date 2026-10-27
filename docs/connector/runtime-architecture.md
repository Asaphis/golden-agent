# Connector Runtime Architecture

## Separation of responsibilities

```text
Desktop interface / CLI
          |
          | protected local IPC
          v
Connector service
          |
          v
Connector core (local brain)
          |
          | authenticated outbound WebSocket
          v
Golden Agent backend
```

The desktop interface is not the connector. The CLI is not the connector. Both are control clients. The background connector service owns the running process, and the connector core owns local security, permission checks, capability reporting, and operation execution.

## Implemented now

- Backend pairing endpoint and SQLite persistence.
- One-time pairing code.
- Connector identity and access token.
- Authenticated outbound WebSocket connection.
- Heartbeat and online status.
- Backend permission-checked health dispatch.
- Connector core operation boundary.
- Core capability reporting.
- Protected Unix-socket IPC for local clients.
- Service runtime that owns the core, IPC, and remote connection.
- Safe approved-root filesystem listing, reading, and writing.
- Optional Ollama model discovery and execution adapter.
- Git status, process listing, and allowlisted terminal operation boundaries.
- Persisted-token reconnect with exponential backoff.
- Application-level IPC secret authentication in addition to socket permissions.
- Live backend-to-connector permission synchronization.
- Integration tests for remote connection, service/IPC, core safety, permission denial, and allowlisted execution.

## Current permission behavior

The service starts with a conservative local permission set:

```text
connector.health
model.discovery
```

Filesystem, Git, terminal, process, browser, testing, and build permissions are declared in the shared contract. Filesystem, Git, terminal, process, and model boundaries are implemented, but risky permissions are not granted by default and must be enabled through backend authorization plus local policy before they can execute. Browser, testing, and build execution remain unimplemented.

## Local IPC

The current development transport is a Unix domain socket:

```text
.data/connector/connector.sock
```

The socket is created with mode `0600`, and every request must also include a per-installation secret stored with mode `0600`. Windows named-pipe transport and platform service installation are separate packaging tasks and must be tested on their target operating systems.

## What remains outside the connector-runtime completion claim

The connector runtime capabilities are implemented and covered by the release check. The desktop/web/mobile interfaces, production PostgreSQL/Redis deployment, signed installer publication, external security review, and native Windows, macOS, Termux, and Docker installation tests remain separate product/release gates. The Linux systemd artifact is syntax-validated in this environment; the other platform artifacts are generated but require their native operating systems for final verification.
