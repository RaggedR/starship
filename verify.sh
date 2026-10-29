#!/usr/bin/env bash
# verify.sh — the Definition of Done, mechanised.
#
#   1. type-check and unit tests pass
#   2. the demo replays byte-identically (stdout AND both logs) across two runs
#
# Run from anywhere: ./verify.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "== deno check =="
deno check src/**/*.ts

echo "== deno test =="
deno test --allow-read --allow-write

echo "== determinism: two demo runs must be byte-identical =="
logs() { cat demo-out/bridge/ships-log.jsonl demo-out/bridge/intent-log.jsonl \
             demo-out/alarm/ships-log.jsonl demo-out/alarm/intent-log.jsonl; }

OUT1="$(deno run --allow-read --allow-write src/demo.ts)"; A="$(logs)"
OUT2="$(deno run --allow-read --allow-write src/demo.ts)"; B="$(logs)"

if [[ "$OUT1" == "$OUT2" && "$A" == "$B" ]]; then
  echo "PASS: stdout and logs are byte-identical across two runs."
else
  echo "FAIL: replay is not deterministic." >&2
  exit 1
fi
