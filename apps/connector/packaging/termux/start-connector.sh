#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
PROJECT_PATH="${GOLDEN_AGENT_PROJECT_PATH:-$HOME/golden-agent}"
cd "$PROJECT_PATH"
exec pnpm exec tsx apps/connector/src/main.ts service
