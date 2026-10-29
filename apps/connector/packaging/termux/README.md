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
pkg install git
corepack enable
corepack install --global pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm build
pnpm connector pair
```

Start the compiled service:

```bash
bash apps/connector/packaging/termux/start-connector.sh
```

The launcher stores state in `$HOME/.golden-agent/connector` unless `CONNECTOR_DATA_PATH` is set. Termux does not provide systemd; use Termux:Boot or a user-managed shell session for startup after reboot.

### Termux connecting to a remote Ubuntu backend

If the backend is running on another machine, replace `SERVER_IP_OR_HOSTNAME` with its reachable LAN address or DNS name. Do not leave these values set to `127.0.0.1`, because on the phone that means the phone itself:

```bash
export CONNECTOR_HTTP_URL="http://SERVER_IP_OR_HOSTNAME:4100"
export CONNECTOR_SERVER_URL="ws://SERVER_IP_OR_HOSTNAME:4100/connect"
pnpm connector pair
```

Copy the one-time pairing code printed by `pair`, then start the service with that code:

```bash
pnpm connector service --pairing-code GLA-XXXX-XXXX
```

After the first successful pairing, the access token is stored locally and future starts can use the launcher:

```bash
bash apps/connector/packaging/termux/start-connector.sh
```

The Ubuntu backend must allow the phone to reach TCP port `4100`; use a firewall rule limited to the private network rather than exposing the backend broadly to the public internet.

Use JSON output for SSH and automation:

```bash
pnpm connector status --json
pnpm connector doctor --json
pnpm connector models list --json
```

Android storage, background-process, browser, and model-runtime restrictions apply. The connector must report unavailable capabilities instead of claiming that desktop-only operations work on Termux.
