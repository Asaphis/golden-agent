# Headless Connector platforms

The Connector does not require the desktop manager. Every supported headless platform uses the same compiled CLI and authenticated local IPC.

## Common CLI setup

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm connector help
```

For scripts and automation, add `--json` to commands that return data:

```bash
node dist/apps/connector/src/main.js status --json
node dist/apps/connector/src/main.js doctor --json
```

## Linux servers and SSH

Interactive foreground mode:

```bash
pnpm connector pair
pnpm connector service
```

Persistent user service:

```bash
GOLDEN_AGENT_PROJECT_PATH="$HOME/golden-agent" \
  bash apps/connector/packaging/linux/install-service.sh
systemctl --user status golden-agent-connector.service
```

The installer renders the systemd unit with the actual project, Node, data, and configuration paths. This supports non-default checkout directories.

## macOS Terminal

```bash
pnpm connector pair
bash apps/connector/packaging/macos/install-service.sh
launchctl print "gui/$(id -u)/com.goldenagent.connector"
```

The launchd installer resolves the active Node executable and writes connector identity, token, IPC secret, and logs under the user data directory.

## Windows Command Prompt or PowerShell

Build the project, then use the same CLI entrypoint:

```powershell
pnpm install --frozen-lockfile
pnpm build
node dist/apps/connector/src/main.js pair
node dist/apps/connector/src/main.js status --json
node dist/apps/connector/src/main.js doctor --json
```

Install the background service from an elevated PowerShell prompt:

```powershell
powershell -ExecutionPolicy Bypass -File .\apps\connector\packaging\windows\install-service.ps1
Get-Service GoldenAgentConnector
```

The CLI uses authenticated localhost TCP IPC on Windows; Linux and macOS use Unix sockets.

## Termux

```bash
pkg update
pkg install nodejs-lts
cd "$HOME/golden-agent"
pnpm install --frozen-lockfile
pnpm build
pnpm connector pair
bash apps/connector/packaging/termux/start-connector.sh
```

The Termux launcher uses the compiled Node entrypoint and stores connector state in `$HOME/.golden-agent/connector` by default. Use Termux:Boot or a user-managed shell session to start it after reboot; Android may stop background processes according to battery and OS policy.

## Docker and containers

Build and run the foreground connector:

```bash
docker build -f infrastructure/docker/connector.Dockerfile -t golden-agent-connector .
docker run --rm -it \
  -e CONNECTOR_SERVER_URL=ws://backend:4100/connect \
  -v golden-agent-connector-data:/data \
  golden-agent-connector
```

The container has no desktop dependency and exposes state through `/data`. Use container logs for service output and a separate `docker exec` shell for CLI diagnostics.

## Capability expectations

The connector must report permission or platform errors rather than claiming unavailable features. Browser automation requires a browser runtime; Ollama operations require Ollama; Termux and minimal containers may not provide either.
