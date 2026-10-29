#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
PROJECT_PATH="${GOLDEN_AGENT_PROJECT_PATH:-$HOME/golden-agent}"
cd "$PROJECT_PATH"

if [[ ! -f dist/apps/connector/src/main.js ]]; then
  echo "Connector is not built. Run: pnpm install && pnpm build" >&2
  exit 1
fi

export CONNECTOR_DATA_PATH="${CONNECTOR_DATA_PATH:-$HOME/.golden-agent/connector}"
export CONNECTOR_IDENTITY_PATH="${CONNECTOR_IDENTITY_PATH:-$CONNECTOR_DATA_PATH/identity.json}"
export CONNECTOR_TOKEN_PATH="${CONNECTOR_TOKEN_PATH:-$CONNECTOR_DATA_PATH/access-token}"
export CONNECTOR_IPC_SECRET_PATH="${CONNECTOR_IPC_SECRET_PATH:-$CONNECTOR_DATA_PATH/ipc-secret}"
mkdir -p "$CONNECTOR_DATA_PATH"
exec node dist/apps/connector/src/main.js service
