#!/usr/bin/env bash
# Start / stop / open PenNodePaper as a background service (used by the start-menu launcher).
#   pennodepaper.sh start   start the server (builds the UI first if needed) and open the browser
#   pennodepaper.sh stop    stop it
#   pennodepaper.sh open    just open the browser
#   pennodepaper.sh status
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PNP_PORT:-4317}"
URL="http://localhost:$PORT"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/pennodepaper"
PIDFILE="$STATE/server.pid"
LOG="$STATE/server.log"
mkdir -p "$STATE"

say() { echo "$*"; command -v notify-send >/dev/null && notify-send -i pennodepaper "PenNodePaper" "$*" 2>/dev/null; return 0; }

listener_pid() { ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2; }
is_up() { [ -n "$(listener_pid)" ]; }

wait_for_up() {
  for _ in $(seq 1 $(($1 * 4))); do is_up && return 0; sleep 0.25; done
  return 1
}

needs_build() {
  local idx="$ROOT/packages/web/dist/index.html"
  [ -f "$idx" ] || return 0
  [ -n "$(find "$ROOT/packages/web/src" "$ROOT/packages/web/index.html" "$ROOT/packages/shared" \
      -path '*/node_modules' -prune -o -type f -newer "$idx" -print -quit 2>/dev/null)" ]
}

cmd_start() {
  if is_up; then say "Already running at $URL"; xdg-open "$URL" >/dev/null 2>&1; return 0; fi
  cd "$ROOT" || exit 1
  if needs_build; then
    say "Building the UI (first start or after an update)…"
    npm run build >"$LOG" 2>&1 || { say "Build failed — see $LOG"; exit 1; }
  fi
  : >"$LOG"
  setsid -f bash -c 'echo $$ >"$1"; exec npm start' _ "$PIDFILE" >>"$LOG" 2>&1 </dev/null
  if wait_for_up 30; then
    say "Running at $URL"
    xdg-open "$URL" >/dev/null 2>&1
  else
    say "Server did not come up — see $LOG"
    exit 1
  fi
}

cmd_stop() {
  local pid=""
  [ -f "$PIDFILE" ] && pid="$(cat "$PIDFILE")"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
  else
    # not started by this launcher (e.g. `npm run dev`): stop it only if it is this repo's server
    local lp; lp="$(listener_pid)"
    if [ -n "$lp" ] && [[ "$(readlink "/proc/$lp/cwd")" == "$ROOT"* ]]; then
      kill -TERM "$lp" 2>/dev/null
    fi
  fi
  rm -f "$PIDFILE"
  for _ in $(seq 1 40); do is_up || { say "Stopped"; return 0; }; sleep 0.25; done
  say "Could not stop the server on port $PORT"
  exit 1
}

case "${1:-start}" in
  start)  cmd_start ;;
  stop)   cmd_stop ;;
  open)   if is_up; then xdg-open "$URL" >/dev/null 2>&1; else cmd_start; fi ;;
  status) if is_up; then echo "running at $URL"; else echo "stopped"; exit 1; fi ;;
  *) echo "usage: $0 start|stop|open|status" >&2; exit 2 ;;
esac
