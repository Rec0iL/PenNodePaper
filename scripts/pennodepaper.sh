#!/usr/bin/env bash
# Start / stop / open PenNodePaper as a background service (used by the start-menu launcher).
#   pennodepaper.sh start       start the server (builds the UI first if needed) and open the browser
#   pennodepaper.sh start-lan   the same, but other devices on your network can use it too (access code needed)
#   pennodepaper.sh stop        stop it
#   pennodepaper.sh open        just open the browser
#   pennodepaper.sh status
#   pennodepaper.sh lan-info    show the address and access code for other devices
#   pennodepaper.sh tray        show the tray icon (start/stop, LAN mode, address, code, updates)
#   pennodepaper.sh check-update   look for a new version (git fetch); --quiet only notes the result for the tray icon
#   pennodepaper.sh update      install the new version (git pull, npm install when a package list changed); a running
#                               server is restarted in the same mode, the UI is rebuilt then
#   pennodepaper.sh version     the installed version (commit and date)
# start / start-lan also bring up the tray icon; PNP_NO_TRAY=1 leaves it out. Linux and macOS.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PNP_PORT:-4317}"
URL="http://localhost:$PORT"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/pennodepaper"
PIDFILE="$STATE/server.pid"
LOG="$STATE/server.log"
mkdir -p "$STATE"

UPDATES="$STATE/updates"   # what the last look for a new version found: a number of new changes (0 = up to date)
MAC=0; [ "$(uname -s)" = Darwin ] && MAC=1

say() {
  echo "$*"
  if [ "$MAC" = 1 ]; then osascript -e "display notification \"${*//\"/\\\"}\" with title \"PenNodePaper\"" >/dev/null 2>&1
  else command -v notify-send >/dev/null && notify-send -i pennodepaper "PenNodePaper" "$*" 2>/dev/null; fi
  return 0
}
open_url() { if [ "$MAC" = 1 ]; then open "$1" >/dev/null 2>&1; else xdg-open "$1" >/dev/null 2>&1; fi; }
# start a command detached from this shell (its own session where setsid exists)
detach() { if command -v setsid >/dev/null; then setsid -f "$@"; else nohup "$@" & disown; fi; }

listener_pid() {
  if command -v ss >/dev/null; then ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2
  else lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1; fi
}
is_up() { [ -n "$(listener_pid)" ]; }
# the folder a process runs in (to tell this installation's server from another one)
cwd_of() {
  if [ -e "/proc/$1/cwd" ]; then readlink "/proc/$1/cwd"
  else lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1; fi
}

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
    if [ "$(server_mode)" = "$want" ]; then say "Already running at $URL"; open_url "$URL"; start_tray; return 0; fi
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
  PNP_LAN="$lan" detach bash -c 'echo $$ >"$1"; exec npm start' _ "$PIDFILE" >>"$LOG" 2>&1 </dev/null
  if wait_for_up 30; then
    if [ "$want" = lan ]; then say "Running at $URL — other devices: $(lan_first_url)"; else say "Running at $URL"; fi
    [ "${PNP_NO_OPEN:-0}" = 1 ] || open_url "$URL"
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
  PNP_NO_TRAY=1 detach "$py" "$ROOT/scripts/pennodepaper-tray.py" >>"$STATE/tray.log" 2>&1 </dev/null
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
    if [ -n "$lp" ] && [[ "$(cwd_of "$lp")" == "$ROOT"* ]]; then
      kill -TERM "$lp" 2>/dev/null
    fi
  fi
  rm -f "$PIDFILE"
  for _ in $(seq 1 40); do is_up || { [ "$quiet" = quiet ] || say "Stopped"; return 0; }; sleep 0.25; done
  say "Could not stop the server on port $PORT"
  exit 1
}

# ---- updates (the same rules as the Windows launcher) -------------------------------------------------------
git_() { GIT_TERMINAL_PROMPT=0 git -C "$ROOT" "$@"; }

cmd_version() { git_ log -1 --format='%h · %cd' --date=short 2>/dev/null || echo unknown; }

# changes of your own block an update; package-lock.json is written by npm itself and does not count
own_changes() { git_ status --porcelain --untracked-files=no | sed 's/^...//' | grep -vx 'package-lock.json'; }

# prints the number of new changes (0 = up to date); exit 1 when it cannot look (no git, offline…)
check_update() {
  [ -d "$ROOT/.git" ] && command -v git >/dev/null || { echo "This installation is not a git checkout — update it by hand." >&2; return 1; }
  local t=""; command -v timeout >/dev/null && t="timeout 30"   # macOS has no timeout of its own
  $t env GIT_TERMINAL_PROMPT=0 git -C "$ROOT" fetch --quiet 2>/dev/null || { echo "Could not reach the server (offline?)." >&2; return 1; }
  git_ rev-list --count 'HEAD..@{u}' 2>/dev/null || { echo "This branch follows nothing to update from." >&2; return 1; }
}

cmd_check_update() {
  local quiet="${1:-}" n err
  if ! n="$(check_update 2>"$STATE/update.err")"; then
    err="$(cat "$STATE/update.err")"
    [ "$quiet" = --quiet ] || say "Could not look for updates: $err"
    return 1
  fi
  echo "$n" >"$UPDATES"
  [ "$quiet" = --quiet ] && { echo "$n"; return 0; }
  if [ "$n" -gt 0 ]; then say "An update is ready: $n new change$([ "$n" = 1 ] || echo s). Install it from the tray icon (Update now)."
  else say "PenNodePaper is up to date ($(cmd_version))."; fi
}

cmd_update() {
  local n mode before changed
  n="$(check_update 2>"$STATE/update.err")" || { say "Could not look for updates: $(cat "$STATE/update.err")"; return 1; }
  if [ "$n" = 0 ]; then echo 0 >"$UPDATES"; say "PenNodePaper is already up to date ($(cmd_version))."; return 0; fi
  if [ -n "$(own_changes)" ]; then say "An update is ready, but this copy has changes of its own — it was not updated (see git status in $ROOT)."; return 1; fi
  mode=down; is_up && mode="$(server_mode)"
  [ "$mode" != down ] && { say "Updating — PenNodePaper restarts in a moment…"; cmd_stop quiet || return 1; }
  git_ checkout -- package-lock.json 2>/dev/null
  before="$(git_ rev-parse HEAD)"
  if ! git_ pull --ff-only --quiet >"$STATE/update.err" 2>&1; then say "The update did not work: $(tail -c 300 "$STATE/update.err")"; return 1; fi
  changed="$(git_ diff --name-only "$before" HEAD)"
  if grep -qE '(^|/)package(-lock)?\.json$' <<<"$changed"; then
    (cd "$ROOT" && npm install --no-audit --no-fund >"$LOG" 2>&1) || { say "npm install failed — see $LOG"; return 1; }
    git_ checkout -- package-lock.json 2>/dev/null
  fi
  echo 0 >"$UPDATES"
  # the page that is open reconnects by itself: no new browser tab
  if [ "$mode" != down ]; then PNP_NO_TRAY=1 PNP_NO_OPEN=1 cmd_start "$mode" >/dev/null || return 1; fi
  say "PenNodePaper was updated to $(cmd_version) ($n new change$([ "$n" = 1 ] || echo s))."
}

case "${1:-start}" in
  start)      cmd_start local ;;
  start-lan)  cmd_start lan ;;
  stop)       cmd_stop ;;
  open)       if is_up; then open_url "$URL"; start_tray; else cmd_start local; fi ;;
  status)     if is_up; then echo "running at $URL ($(server_mode) mode)"; else echo "stopped"; exit 1; fi ;;
  lan-info)   cmd_lan_info ;;
  tray)       PNP_NO_TRAY=0 start_tray ;;
  check-update) cmd_check_update "${2:-}" ;;
  update)     cmd_update ;;
  version)    cmd_version ;;
  *) echo "usage: $0 start|start-lan|stop|open|status|lan-info|tray|check-update [--quiet]|update|version" >&2; exit 2 ;;
esac
