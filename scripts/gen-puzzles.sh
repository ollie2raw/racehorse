#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

if command -v tsx >/dev/null 2>&1; then
  tsx server/src/generatePuzzles.ts "$@"
else
  npx tsx server/src/generatePuzzles.ts "$@"
fi
