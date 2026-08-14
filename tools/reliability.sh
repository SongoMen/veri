#!/usr/bin/env bash
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

set -uo pipefail
URL="${1:?usage: reliability.sh <url> <identity> <n> [label]}"
IDENTITY="${2:?}"
N="${3:-10}"
LABEL="${4:-$IDENTITY}"
BIN="${BIN:-./target/release/fetch}"

challenged=0; cleared=0; skipped=0
declare -a solve_ms
declare -a failures

for i in $(seq "$N"); do
  out=$("$BIN" "$URL" "$IDENTITY" 2>&1)

  if ! printf '%s' "$out" | grep -q '\[cleared '; then
    skipped=$((skipped + 1)); printf '.'; continue
  fi
  challenged=$((challenged + 1))

  ms=$(printf '%s' "$out" | grep -oE 'in [0-9.]+m?s' | head -1 | sed 's/in //')
  [ -n "$ms" ] && solve_ms+=("$ms")

  if printf '%s' "$out" | grep -qE '^200 +ok'; then
    cleared=$((cleared + 1)); printf 'C'
  else
    failures+=("iter $i: $(printf '%s' "$out" | head -1)")
    printf 'x'
  fi
done

echo ""
echo "── $LABEL ─────────────────────────────────"
echo "  iterations        : $N"
echo "  challenged        : $challenged   (skipped, no challenge: $skipped)"
echo "  solved            : $cleared/$challenged"
if [ ${#solve_ms[@]} -gt 0 ]; then
  echo "  solve times       : ${solve_ms[*]}"
fi
if [ ${#failures[@]} -gt 0 ]; then
  echo "  failures:"
  printf '    %s\n' "${failures[@]}"
fi
