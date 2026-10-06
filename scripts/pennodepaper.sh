#!/usr/bin/env bash
# Start / stop / open PenNodePaper as a background service (used by the start-menu launcher).
#   pennodepaper.sh start       start the server (builds the UI first if needed) and open the browser
#   pennodepaper.sh start-lan   the same, but other devices on your network can use it too (access code needed)
#   pennodepaper.sh stop        stop it
#   pennodepaper.sh open        just open the browser
#   pennodepaper.sh status
#   pennodepaper.sh lan-info    show the address and access code for other devices
#   pennodepaper.sh tray        show the tray icon (start/stop, LAN mode, address, code)
# start / start-lan also bring up the tray icon; PNP_NO_TRAY=1 leaves it out.
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

# "lan", "local" or "down" — asked of the running server itself, from this computer
server_mode() {
  local j; j="$(curl -s -m 2 "http://127.0.0.1:$PORT/api/lan" 2>/dev/null)" || { echo down; return; }
  case "$j" in *'"enabled":true'*) echo lan ;; *'"enabled":false'*) echo local ;; *) echo down ;; esac
}

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

# cmd_start [lan]: a running server in the other mode is restarted into the wanted one
cmd_start() {
  local want="${1:-local}"
  if is_up; then
    if [ "$(server_mode)" = "$want" ]; then say "Already running at $URL"; xdg-open "$URL" >/dev/null 2>&1; start_tray; return 0; fi
    say "Switching to ${want} mode…"
    cmd_stop quiet || return 1
  fi
  cd "$ROOT" || exit 1
  if needs_build; then
    say "Building the UI (first start or after an update)…"
    npm run build >"$LOG" 2>&1 || { say "Build failed — see $LOG"; exit 1; }
  fi
  : >"$LOG"
  local lan=0; [ "$want" = lan ] && lan=1
  PNP_LAN="$lan" setsid -f bash -c 'echo $$ >"$1"; exec npm start' _ "$PIDFILE" >>"$LOG" 2>&1 </dev/null
  if wait_for_up 30; then
    if [ "$want" = lan ]; then say "Running at $URL — other devices: $(lan_first_url)"; else say "Running at $URL"; fi
    xdg-open "$URL" >/dev/null 2>&1
    start_tray
  else
    say "Server did not come up — see $LOG"
    exit 1
  fi
}

# first address another device can type, e.g. http://192.168.0.153:4317
lan_first_url() { curl -s -m 2 "http://127.0.0.1:$PORT/api/lan" | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("urls") or ["(none found)"])[0])' 2>/dev/null; }

cmd_lan_info() {
  local j; j="$(curl -s -m 2 "http://127.0.0.1:$PORT/api/lan" 2>/dev/null)"
  if [ -z "$j" ]; then say "PenNodePaper is not running"; return 1; fi
  local text
  text="$(printf '%s' "$j" | python3 -c '
import json, sys
d = json.load(sys.stdin)
if not d.get("enabled"):
    print("LAN mode is OFF — only this computer can use PenNodePaper.\n\nStart it in LAN mode from the start menu (right-click) or the tray icon.")
else:
    print("Open on the other device:\n  " + "\n  ".join(d.get("urls") or ["(no network address found)"]) + "\n\nAccess code:\n  " + d.get("code", "?") + "\n\n(typed once on that device; capitals, spaces and dashes do not matter)")
')"
  echo "$text"
  if command -v kdialog >/dev/null; then kdialog --title "PenNodePaper — LAN" --msgbox "$(printf '%s' "$text" | sed ':a;N;$!ba;s/\n/<br>/g')" 2>/dev/null
  elif command -v zenity >/dev/null; then zenity --info --title "PenNodePaper — LAN" --text "$text" 2>/dev/null
  else command -v notify-send >/dev/null && notify-send -i pennodepaper "PenNodePaper — LAN" "$text"; fi
}

# the tray icon: one instance (it locks itself), needs PyQt6 or PySide6
start_tray() {
  [ "${PNP_NO_TRAY:-0}" = 1 ] && return 0
  # the first Python that can really import Qt (a pip PyQt6 next to a different system Qt breaks one of them)
  local py="" cand
  for cand in python3 /usr/bin/python3 /usr/bin/python3.10 /usr/bin/python3.12; do
    command -v "$cand" >/dev/null && "$cand" "$ROOT/scripts/pennodepaper-tray.py" --probe >/dev/null 2>&1 && { py="$cand"; break; }
  done
  [ -n "$py" ] || return 0
  PNP_NO_TRAY=1 setsid -f "$py" "$ROOT/scripts/pennodepaper-tray.py" >>"$STATE/tray.log" 2>&1 </dev/null
}

cmd_stop() {
  local quiet="${1:-}"
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
  for _ in $(seq 1 40); do is_up || { [ "$quiet" = quiet ] || say "Stopped"; return 0; }; sleep 0.25; done
  say "Could not stop the server on port $PORT"
  exit 1
}

case "${1:-start}" in
  start)      cmd_start local ;;
  start-lan)  cmd_start lan ;;
  stop)       cmd_stop ;;
  open)       if is_up; then xdg-open "$URL" >/dev/null 2>&1; start_tray; else cmd_start local; fi ;;
  status)     if is_up; then echo "running at $URL ($(server_mode) mode)"; else echo "stopped"; exit 1; fi ;;
  lan-info)   cmd_lan_info ;;
  tray)       PNP_NO_TRAY=0 start_tray ;;
  *) echo "usage: $0 start|start-lan|stop|open|status|lan-info|tray" >&2; exit 2 ;;
esac
