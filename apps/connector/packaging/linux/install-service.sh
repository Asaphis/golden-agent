#!/usr/bin/env bash
set -euo pipefail

PROJECT_PATH="${GOLDEN_AGENT_PROJECT_PATH:-$HOME/golden-agent}"
SERVICE_DIR="$HOME/.config/systemd/user"
CONFIG_DIR="$HOME/.config/golden-agent"
mkdir -p "$SERVICE_DIR" "$CONFIG_DIR"

cd "$PROJECT_PATH"
pnpm install --frozen-lockfile
pnpm build
cp "$PROJECT_PATH/apps/connector/packaging/systemd/golden-agent-connector.service" "$SERVICE_DIR/golden-agent-connector.service"

if [[ ! -f "$CONFIG_DIR/connector.env" ]]; then
  cat > "$CONFIG_DIR/connector.env" <<EOF
CONNECTOR_SERVER_URL=ws://127.0.0.1:4100/connect
CONNECTOR_DATA_PATH=$HOME/.data/connector
CONNECTOR_IDENTITY_PATH=$HOME/.data/connector/identity.json
CONNECTOR_TOKEN_PATH=$HOME/.data/connector/access-token
CONNECTOR_IPC_SECRET_PATH=$HOME/.data/connector/ipc-secret
CONNECTOR_ALLOWED_ROOTS=$PROJECT_PATH
CONNECTOR_PERMISSIONS=connector.health,model.discovery
CONNECTOR_TERMINAL_COMMANDS=
EOF
  chmod 600 "$CONFIG_DIR/connector.env"
fi

systemctl --user daemon-reload
systemctl --user enable --now golden-agent-connector.service
systemctl --user --no-pager --full status golden-agent-connector.service
