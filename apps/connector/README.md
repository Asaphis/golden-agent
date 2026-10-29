# Golden Agent Connector

The connector is the local computer runtime. It is separate from any desktop interface and can be managed graphically or entirely from a terminal.

```text
Desktop Manager / Headless CLI
          ↓ protected local IPC
Connector service
          ↓
Connector core
          ↓ authenticated outbound WebSocket
Golden Agent backend
```

## Runtime capabilities

- Device identity and persisted connector token.
- One-time pairing and QR/manual pairing payloads.
- Authenticated backend connection, heartbeats, and reconnect backoff.
- Background service runtime.
- Protected Unix-socket IPC on Linux/macOS/SSH/Termux.
- Authenticated localhost TCP IPC on Windows.
- Permissioned health, system, model-discovery, filesystem, Git, process, terminal, and browser boundaries.
- Safe approved-root path policy.
- Allowlisted terminal-command policy.
- Optional Ollama discovery and execution.

## Headless CLI

After building the repository, the compiled entry point is:

```bash
node dist/apps/connector/src/main.js <command>
```

The root package also exposes the executable name `golden-agent-connector` when installed as a package. During development use:

```bash
pnpm connector <command>
```

Examples:

```bash
pnpm connector help
pnpm connector pair
pnpm connector status
pnpm connector status --json
pnpm connector doctor --json
pnpm connector permissions list
pnpm connector permissions set --permissions connector.health,model.discovery
pnpm connector models list
pnpm connector models run --model qwen2.5:7b --prompt "Say hello"
pnpm connector resources list --path .
pnpm connector resources read --path README.md
pnpm connector git status --path .
pnpm connector process list
pnpm connector terminal run --command echo --args hello
pnpm connector service start
pnpm connector service stop
```

Browser sessions are also available without a graphical desktop:

```bash
pnpm connector browser open --json
pnpm connector browser navigate --session SESSION_ID --url https://example.com
pnpm connector browser inspect --session SESSION_ID
pnpm connector browser screenshot --session SESSION_ID
pnpm connector browser close --session SESSION_ID
```

Use `--json` for SSH scripts, Termux automation, containers, and other non-interactive environments. Remote permissions are controlled by the backend; risky local permissions are not enabled by default.

## Service commands

For a foreground service:

```bash
pnpm connector service
```

For a CLI-managed detached service:

```bash
pnpm connector service start
pnpm connector service status
pnpm connector service stop
```

Platform installers remain responsible for integrating the service with systemd, launchd, Windows Service Control Manager, or Termux startup.
