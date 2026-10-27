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
- Safe approved-root filesystem boundary.
- Optional Ollama model discovery adapter.
- Git status operation boundary.
- Integration tests for remote connection and local service/IPC operation.

## Current permission behavior

The service starts with a conservative local permission set:

```text
connector.health
model.discovery
```

Filesystem, Git, terminal, browser, process, testing, and build permissions are declared in the shared contract but are not granted by default. Implementations must be added and explicitly enabled through backend authorization and local policy before they can execute.

## Local IPC

The current development transport is a Unix domain socket:

```text
.data/connector/connector.sock
```

The socket is created with mode `0600`, so it is accessible only to the local user. Windows named-pipe transport and platform service installation are separate packaging tasks and must be tested on their target operating systems.

## What is deliberately not claimed as complete

The desktop interface, Windows installer, Linux systemd unit, macOS launchd integration, Termux packaging, terminal execution, browser automation, full model execution, and production PostgreSQL deployment are not yet implemented. The runtime boundary is prepared for those capabilities, but they must not be marked complete until their code and platform-specific tests exist.
