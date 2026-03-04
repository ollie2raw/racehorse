#!/bin/bash
cd "$(dirname "$0")/.."
npx tsx server/src/generatePuzzles.ts "$@"
