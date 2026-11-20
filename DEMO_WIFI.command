#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ ! -x "$ROOT/backend/.venv/bin/python" ]]; then
  print "[ERROR] Python environment missing. See docs/LOCAL_SETUP_MAC.md."
  if [[ -t 0 ]]; then read -k 1 "?Press any key to close..."; print; fi
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  for bin in /opt/homebrew/opt/node@22/bin /usr/local/opt/node@22/bin /opt/homebrew/bin /usr/local/bin; do
    if [[ -x "$bin/npm" && -x "$bin/node" ]]; then
      export PATH="$bin:$PATH"
      break
    fi
  done
fi

if ! command -v npm >/dev/null 2>&1; then
  print "[ERROR] Node.js/npm missing. Install Node.js 22 or newer."
  if [[ -t 0 ]]; then read -k 1 "?Press any key to close..."; print; fi
  exit 1
fi

exec "$ROOT/backend/.venv/bin/python" "$ROOT/backend/demo_wifi.py" "$@"
