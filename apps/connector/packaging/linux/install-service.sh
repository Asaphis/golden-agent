#!/usr/bin/env bash
set -euo pipefail
SERVICE_DIR="$HOME/.config/systemd/user"
mkdir -p "$SERVICE_DIR"
cp "$(dirname "$0")/../systemd/golden-agent-connector.service" "$SERVICE_DIR/golden-agent-connector.service"
systemctl --user daemon-reload
systemctl --user enable --now golden-agent-connector.service
echo "Golden Agent Connector service installed and started."
