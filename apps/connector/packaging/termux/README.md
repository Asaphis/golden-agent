# Headless and Termux operation

The Connector service and CLI do not require a graphical interface. The full multi-platform deployment guide is in `docs/connector/headless-platforms.md`.

## SSH/Linux

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm connector pair
pnpm connector service
```

For a persistent Linux deployment, use:

```bash
GOLDEN_AGENT_PROJECT_PATH="$HOME/golden-agent" \
  bash apps/connector/packaging/linux/install-service.sh
```

## Termux

Install Node.js and build the connector once:

```bash
pkg install nodejs-lts
pnpm install --frozen-lockfile
pnpm build
pnpm connector pair
```

Start the compiled service:

```bash
bash apps/connector/packaging/termux/start-connector.sh
```

The launcher stores state in `$HOME/.golden-agent/connector` unless `CONNECTOR_DATA_PATH` is set. Termux does not provide systemd; use Termux:Boot or a user-managed shell session for startup after reboot.

Use JSON output for SSH and automation:

```bash
pnpm connector status --json
pnpm connector doctor --json
pnpm connector models list --json
```

Android storage, background-process, browser, and model-runtime restrictions apply. The connector must report unavailable capabilities instead of claiming that desktop-only operations work on Termux.
