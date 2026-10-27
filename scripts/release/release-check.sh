#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
pnpm build
pnpm validate:packaging
pnpm test:connector
if grep -RInE 'TODO|FIXME|not implemented|pretend|stub' apps packages --include='*.ts'; then
  echo "Release check failed: unfinished implementation marker found" >&2
  exit 1
fi
git diff --check
printf '%s\n' "Release check passed. Native platform installation and external security review remain release-owner gates."
