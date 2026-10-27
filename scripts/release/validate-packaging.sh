#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

pnpm build
[[ -f dist/apps/connector/src/main.js ]]
[[ -f apps/connector/packaging/systemd/golden-agent-connector.service ]]
[[ -f apps/connector/packaging/windows/install-service.ps1 ]]
[[ -f apps/connector/packaging/macos/com.goldenagent.connector.plist ]]
[[ -f apps/connector/packaging/termux/start-connector.sh ]]
[[ -f infrastructure/docker/connector.Dockerfile ]]
node dist/apps/connector/src/main.js unknown >/tmp/golden-agent-packaging-check.log 2>&1 || true
grep -q "Unknown command" /tmp/golden-agent-packaging-check.log
printf '%s\n' "Packaging validation passed. Native Windows, macOS, Termux, and Docker daemon tests must run on their target platforms."
