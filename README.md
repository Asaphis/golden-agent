# Golden Agent

Initial implementation: a real backend, connector core, background service, and headless connector vertical slice.

## Requirements

- Node.js 22+
- pnpm or npm

No external database is required for local development. The backend uses SQLite through Node's built-in `node:sqlite` module and stores it under `.data/`.

## Install

```bash
pnpm install
```

## Run the backend

```bash
pnpm dev:backend
```

The backend listens on `http://127.0.0.1:4100` and accepts connector WebSocket connections at `/connect`.

## Pair and run a connector service

In another terminal:

```bash
pnpm dev:connector pair
pnpm dev:connector service --pairing-code GLA-XXXX-XXXX
```

The pairing command requests a one-time code from the local backend. The service creates the local connector core, starts protected local IPC, opens the outbound backend connection, and keeps running without a desktop interface.

```bash
pnpm dev:connector service --pairing-code GLA-XXXX-XXXX
```

The connector creates a local identity under `.data/connector`, opens an outbound WebSocket connection, sends heartbeats, and answers the backend's permission-checked health request.

Inspect the service through local IPC:

```bash
pnpm dev:connector status
pnpm dev:connector capabilities
```

## Test the complete flows

```bash
pnpm test:connector

pnpm exec tsx tests/integration/connector-service-flow.ts
```

The tests start the backend in-process, pair a connector, authenticate it, verify online heartbeat, exercise the permission-checked health operation, and verify the background service's local IPC and core operation path.

This is the first complete runtime foundation, not the complete Golden Agent product. It establishes the real protocol, persistence, pairing, authorization, audit, connection, connector core, background service, local IPC, capability reporting, and test foundations on which model and tool capabilities will be added.
