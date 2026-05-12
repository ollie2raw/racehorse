#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

FROM=""
DAYS=30
OVERWRITE_EXISTING=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from)
      FROM="${2:-}"
      shift 2
      ;;
    --days)
      DAYS="${2:-}"
      shift 2
      ;;
    --overwrite-existing)
      OVERWRITE_EXISTING=true
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$FROM" ]]; then
  echo "Missing required argument: --from YYYY-MM-DD" >&2
  exit 1
fi

if ! [[ "$FROM" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "Invalid --from date: $FROM" >&2
  exit 1
fi

if ! [[ "$DAYS" =~ ^[0-9]+$ ]] || [[ "$DAYS" -le 0 ]]; then
  echo "--days must be a positive integer." >&2
  exit 1
fi

date_add_days() {
  local base="$1"
  local offset="$2"
  if date -d "${base} +${offset} days" +%F >/dev/null 2>&1; then
    date -d "${base} +${offset} days" +%F
  else
    date -j -f "%Y-%m-%d" "$base" -v+"${offset}"d +%F
  fi
}

run_ladder_seed() {
  local date_key="$1"
  local force_flag=""
  if [[ "$OVERWRITE_EXISTING" == true ]]; then
    force_flag="--force"
  fi
  
  if command -v tsx >/dev/null 2>&1; then
    tsx server/src/seedDailyPuzzleLadder.ts --date "$date_key" $force_flag
    return
  fi
  if command -v npx >/dev/null 2>&1; then
    npx tsx server/src/seedDailyPuzzleLadder.ts --date "$date_key" $force_flag
    return
  fi
  node server/dist/seedDailyPuzzleLadder.js --date "$date_key" $force_flag
}

echo "Seeding Daily Puzzle ladders from $FROM for $DAYS day(s)..."
if [[ "$OVERWRITE_EXISTING" == true ]]; then
  echo "Existing slots will be upserted by date/slot/set_version."
fi

for (( offset = 0; offset < DAYS; offset += 1 )); do
  DATE_KEY="$(date_add_days "$FROM" "$offset")"
  echo "==> $DATE_KEY"
  run_ladder_seed "$DATE_KEY"
done
