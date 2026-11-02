#!/bin/bash
# Double-click on a Mac: builds on first run, serves on localhost, opens the browser.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null; then
  echo "Node.js 22.12 or newer is needed: https://nodejs.org" ; read -r ; exit 1
fi
[ -d node_modules ] || npm ci || { read -r; exit 1; }
[ -f dist/index.html ] || npm run build || { read -r; exit 1; }
exec node scripts/serve.mjs --open
