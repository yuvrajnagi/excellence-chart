#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
RUN_ROOT="$(mktemp -d)"
export TMPDIR="$RUN_ROOT/tmp"
export NODE_COMPILE_CACHE="$RUN_ROOT/node-cache"
export BUN_RUNTIME_TRANSPILER_CACHE_PATH="$RUN_ROOT/bun-cache"
mkdir -p "$TMPDIR" "$NODE_COMPILE_CACHE" "$BUN_RUNTIME_TRANSPILER_CACHE_PATH"
cleanup() {
  status=$?
  trap - EXIT
  rm -rf -- "$RUN_ROOT"
  printf 'OPENEXCEL_CLEANUP root=%s removed=%s exit=%s\n' "$RUN_ROOT" "$([ ! -e "$RUN_ROOT" ] && echo yes || echo no)" "$status"
  exit "$status"
}
trap cleanup EXIT
command="${1:?Expected dev, test, typecheck, build, test:e2e, benchmark or samples}"
shift
case "$command" in
  dev) node scripts/dev.mjs "$@" ;;
  typecheck) npx --no-install tsc -b --pretty false; npx --no-install tsc -p tsconfig.tests.json --pretty false ;;
  test) npx --no-install tsc -b --pretty false; npx --no-install vitest run "$@" ;;
  build) npx --no-install tsc -b --pretty false; npx --no-install vite build --config apps/web/vite.config.ts "$@" ;;
  test:e2e) npm run build; npx --no-install playwright test "$@" ;;
  benchmark) npm run build; node --import tsx benchmarks/run.ts "$@" ;;
  samples) npm run build; node --import tsx samples/generate.ts "$@" ;;
  *) printf 'Unknown command: %s\n' "$command" >&2; exit 2 ;;
esac
