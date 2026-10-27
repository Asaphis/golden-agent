#!/usr/bin/env bash
set -euo pipefail
PROJECT_PATH="${GOLDEN_AGENT_PROJECT_PATH:-$HOME/golden-agent}"
PLIST="$HOME/Library/LaunchAgents/com.goldenagent.connector.plist"
mkdir -p "$HOME/Library/Logs/GoldenAgent" "$HOME/Library/LaunchAgents"
cd "$PROJECT_PATH"
pnpm install --frozen-lockfile
pnpm build
sed -e "s#__PROJECT_PATH__#$PROJECT_PATH#g" -e "s#__HOME__#$HOME#g" "$PROJECT_PATH/apps/connector/packaging/macos/com.goldenagent.connector.plist" > "$PLIST"
launchctl bootout "gui/$(id -u)/com.goldenagent.connector" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/com.goldenagent.connector"
launchctl print "gui/$(id -u)/com.goldenagent.connector"
