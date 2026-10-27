# Golden Agent Connector

The connector is the local computer runtime. It is separate from any desktop interface.

```text
Desktop UI / CLI
      ↓ protected local IPC
Connector service
      ↓
Connector core
      ↓ authenticated outbound WebSocket
Golden Agent backend
```

## Current runtime

- Device identity and persisted connector token.
- One-time pairing.
- Authenticated backend connection.
- Heartbeats and reconnect backoff.
- Background service runtime.
- Protected Unix-socket IPC in development.
- Capability reporting.
- Permissioned health, system, model-discovery, filesystem, Git, process, and terminal operation boundaries.
- Safe approved-root path policy.
- Allowlisted terminal-command policy.
- Optional Ollama discovery and execution.

## Commands

```bash
pnpm dev:connector pair
pnpm dev:connector service --pairing-code CODE
pnpm dev:connector status
pnpm dev:connector capabilities
```

Remote permissions are controlled by the backend. Risky local permissions are not enabled by default.
