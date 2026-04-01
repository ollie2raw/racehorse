#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

if command -v tsx >/dev/null 2>&1; then
  tsx scripts/gen-gauntlet.ts "$@"
else
  npx tsx scripts/gen-gauntlet.ts "$@"
fi
