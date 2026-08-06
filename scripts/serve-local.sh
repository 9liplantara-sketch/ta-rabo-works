#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8888}"

if lsof -ti ":$PORT" >/dev/null 2>&1; then
  echo "Stopping existing server on port $PORT..."
  lsof -ti ":$PORT" | xargs kill -9 2>/dev/null || true
  sleep 0.3
fi

cd "$ROOT"
echo "Serving $ROOT at http://localhost:$PORT/"
echo "  加工フローチャート: http://localhost:$PORT/process-flow/index.html"
echo "  アナログツール:     http://localhost:$PORT/ta_rabo_profile.html#analog-section"
echo "Press Ctrl+C to stop."
exec python3 -m http.server "$PORT"
