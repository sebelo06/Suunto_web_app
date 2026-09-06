#!/usr/bin/env bash
#
# Lance le front (http://localhost:8080) et/ou le back (http://localhost:3000).
#
# Usage:
#   ./dev.sh          # lance les deux (défaut)
#   ./dev.sh front    # front seul
#   ./dev.sh back     # back seul
#   ./dev.sh both     # les deux (explicite)
#
# Ctrl+C coupe proprement tout ce qui a été lancé.

set -euo pipefail
cd "$(dirname "$0")"

TARGET="${1:-both}"
PIDS=()

cleanup() {
  echo ""
  echo "→ Arrêt en cours..."
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  echo "→ Stoppé."
}
trap cleanup INT TERM EXIT

start_front() {
  echo "→ Front  : http://localhost:8080"
  npx http-server . -p 8080 -c-1 &
  PIDS+=($!)
}

start_back() {
  echo "→ Back   : http://localhost:3000"
  npm run dev &
  PIDS+=($!)
}

case "$TARGET" in
  front) start_front ;;
  back)  start_back ;;
  both)  start_back; start_front ;;
  *)
    echo "Usage: ./dev.sh [front|back|both]" >&2
    exit 1
    ;;
esac

echo "→ Ctrl+C pour tout arrêter."
wait
