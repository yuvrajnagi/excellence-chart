#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${1:-3001}"
DB_PATH="${2:-$DIR/openexcel.sqlite}"

echo "=========================================================="
echo " Starting OpenExcel Test Release (Rust Desktop + WASM Web)"
echo " URL:             http://127.0.0.1:$PORT"
echo " SQLite Database: $DB_PATH"
echo " Web UI Root:     $DIR/web"
echo "=========================================================="

exec "$DIR/bin/openexcel-desktop" serve \
  --port "$PORT" \
  --db-path "$DB_PATH" \
  --static-dir "$DIR/web"
