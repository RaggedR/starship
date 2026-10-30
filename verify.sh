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

echo "== determinism: two MAZE runs (scripted agent) must be byte-identical =="
mazelogs() { cat maze-out/run/dungeon-log.jsonl maze-out/run/intent-log.jsonl; }

# No --live here: the scripted BFS solver is deterministic and needs no API key.
MOUT1="$(deno run --allow-read --allow-write --allow-net --allow-env src/maze-demo.ts)"; MA="$(mazelogs)"
MOUT2="$(deno run --allow-read --allow-write --allow-net --allow-env src/maze-demo.ts)"; MB="$(mazelogs)"

if [[ "$MOUT1" == "$MOUT2" && "$MA" == "$MB" ]]; then
  echo "PASS: the maze agent's stdout and logs are byte-identical across two runs."
else
  echo "FAIL: maze replay is not deterministic." >&2
  exit 1
fi

echo "== determinism: two FLEET runs (scout/fighter/captain) must be byte-identical =="
fleetlogs() { cat demo-out/fleet/dungeon-log.jsonl demo-out/fleet/intent-log.jsonl \
                  demo-out/fleet/trace.json demo-out/fleet/index.html; }

FOUT1="$(deno run --allow-read --allow-write --allow-net --allow-env src/fleet-maze-demo.ts)"; FA="$(fleetlogs)"
FOUT2="$(deno run --allow-read --allow-write --allow-net --allow-env src/fleet-maze-demo.ts)"; FB="$(fleetlogs)"

if [[ "$FOUT1" == "$FOUT2" && "$FA" == "$FB" ]]; then
  echo "PASS: the fleet's stdout, logs, trace, and generated site are byte-identical across two runs."
else
  echo "FAIL: fleet replay is not deterministic." >&2
  exit 1
fi
