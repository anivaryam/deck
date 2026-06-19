#!/usr/bin/env bash
# Dev runner for the vite web server, with HMR-poison auto-restart.
#
# Why this exists: vite's HMR handles ordinary source edits in-process and fast.
# But when many files are rewritten *underneath* a long-lived vite — a git
# checkout / commit / rebase / merge — or when deps/build config change, HMR can
# leave the running tab serving a torn module graph: a stale bundle that renders
# objects React can't handle and crashes at runtime. A full page reload fixes it,
# but only because it refetches a *consistent* bundle.
#
# This wrapper leaves normal edits to HMR (dev loop stays fast) and does a full
# vite process restart ONLY on those poison events, so the served bundle is always
# internally consistent. After a restart, hard-reload the tab.
set -u

cd "$(dirname "$0")" || exit 1            # -> web/
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ..)"
POLL="${DEV_WATCH_POLL:-2}"               # seconds between checks

# Files whose change invalidates the running module graph. Plain source edits are
# deliberately NOT here — HMR owns those.
watch_targets() {
  printf '%s\n' package.json bun.lock vite.config.ts tsconfig.json
  printf '%s\n' "$ROOT/.git/index" "$ROOT/.git/HEAD"   # commit/checkout/rebase/merge
  local ref
  ref="$(git -C "$ROOT" symbolic-ref -q HEAD 2>/dev/null)"   # active branch ref moves on commit
  [ -n "$ref" ] && printf '%s\n' "$ROOT/.git/$ref"
}

fingerprint() {
  watch_targets | while read -r f; do
    [ -e "$f" ] && stat -c '%n %Y' "$f" 2>/dev/null
  done | sort
}

VITE_PID=""
start() { bun run dev & VITE_PID=$!; }
stop()  {
  [ -n "$VITE_PID" ] && kill "$VITE_PID" 2>/dev/null
  [ -n "$VITE_PID" ] && wait "$VITE_PID" 2>/dev/null
  VITE_PID=""
}
cleanup() { stop; exit 0; }                # proc-compose stop / Ctrl+C -> clean exit
trap cleanup TERM INT

start
prev="$(fingerprint)"
while true; do
  sleep "$POLL"
  # vite exited on its own (config error, manual kill): surface its code so
  # proc-compose sees the stop instead of us masking it.
  if ! kill -0 "$VITE_PID" 2>/dev/null; then
    wait "$VITE_PID"; exit $?
  fi
  cur="$(fingerprint)"
  if [ "$cur" != "$prev" ]; then
    echo "[dev-watch] HMR-poison change detected -> restarting vite (hard-reload the tab)"
    prev="$cur"
    stop
    start
  fi
done
