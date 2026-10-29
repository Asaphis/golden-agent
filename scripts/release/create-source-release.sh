#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

VERSION="${VERSION:-$(node -p "require('./package.json').version")}"
OUTPUT_DIR="${OUTPUT_DIR:-dist/release}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="${2:?missing version}"; shift 2 ;;
    --output) OUTPUT_DIR="${2:?missing output directory}"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid release version: $VERSION" >&2
  exit 2
fi

COMMIT="$(git rev-parse HEAD)"
mkdir -p "$OUTPUT_DIR"
ARCHIVE="$OUTPUT_DIR/golden-agent-$VERSION-source.tar.gz"
git archive --format=tar.gz --prefix="golden-agent-$VERSION/" --output="$ARCHIVE" HEAD
sha256sum "$ARCHIVE" > "$ARCHIVE.sha256"

node - "$ARCHIVE" "$VERSION" "$COMMIT" > "$OUTPUT_DIR/golden-agent-$VERSION-release.json" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const [archive, version, commit] = process.argv.slice(2);
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
const manifest = { name: 'golden-agent', version, commit, artifact: archive, sha256, generatedAt: new Date().toISOString() };
process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
NODE

printf 'Source release created:\n%s\n%s\n%s\n' "$ARCHIVE" "$ARCHIVE.sha256" "$OUTPUT_DIR/golden-agent-$VERSION-release.json"
