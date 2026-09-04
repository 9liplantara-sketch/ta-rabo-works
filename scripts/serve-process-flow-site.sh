#!/usr/bin/env bash
# Serve the GitHub Pages–shaped tree so site export (basePath=/ta-rabo-works/process-flow) works locally.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8899}"
STAGE="$ROOT/.serve-gh-pages"
KIND_FILE="$ROOT/process-flow/.export-kind"

if [[ ! -f "$ROOT/process-flow/index.html" ]]; then
  echo "Missing process-flow/index.html. Run: npm run build:process-flow:site" >&2
  exit 1
fi

if [[ -f "$KIND_FILE" ]] && ! grep -q '^site$' "$KIND_FILE" && ! grep -q '^site' "$KIND_FILE"; then
  echo "Warning: process-flow/.export-kind does not look like a site export." >&2
  cat "$KIND_FILE" >&2 || true
fi

if ! grep -q '/ta-rabo-works/process-flow/_next/' "$ROOT/process-flow/index.html"; then
  echo "process-flow/index.html is not a site export (missing /ta-rabo-works/process-flow/_next/)." >&2
  echo "Run: npm run build:process-flow:site" >&2
  exit 1
fi

if lsof -ti ":$PORT" >/dev/null 2>&1; then
  echo "Stopping existing server on port $PORT..."
  lsof -ti ":$PORT" | xargs kill -9 2>/dev/null || true
  sleep 0.3
fi

rm -rf "$STAGE"
mkdir -p "$STAGE/ta-rabo-works"
# Repo-root pages that header links expect under /ta-rabo-works/
ln -s "$ROOT/index.html" "$STAGE/ta-rabo-works/index.html"
ln -s "$ROOT/ta_rabo_profile.html" "$STAGE/ta-rabo-works/ta_rabo_profile.html"
ln -s "$ROOT/process-flow" "$STAGE/ta-rabo-works/process-flow"

echo "Serving GitHub Pages simulation at http://localhost:$PORT/"
echo "  加工フローチャート: http://localhost:$PORT/ta-rabo-works/process-flow/"
echo "  Portal target:     http://localhost:$PORT/ta-rabo-works/index.html"
echo "Press Ctrl+C to stop."
cd "$STAGE"
exec python3 -m http.server "$PORT"
