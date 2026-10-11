#!/usr/bin/env bash
# PenNodePaper installer (Linux, macOS, and Windows inside WSL2).
#
# Run it from anywhere; it works in the folder it lives in:
#     ./scripts/install.sh              install, build, offer the optional tools
#     ./scripts/install.sh --check      only report what is installed, change nothing
#     ./scripts/install.sh --yes        say yes to everything (install the optional tools too)
#     ./scripts/install.sh --no-tools   never touch system packages
#     ./scripts/install.sh --no-build   skip building the web UI (npm run dev does not need it)
#
# What it does:  checks Node.js 20+, runs `npm install` in this folder, builds the web UI, and — if you agree —
# installs the optional helper tools (WeasyPrint for the GM binder PDF, ImageMagick for thumbnails, poppler + unzip
# for importing .pdf / .docx notes, git) with your system's package manager (it asks for sudo; it never runs
# anything without telling you which command).
#
# What it does NOT do:  install the AI assistants (claude, agy) or ComfyUI. Those are yours to choose and log in
# to; docs/INSTALL.md walks through them. It only tells you whether it can see them.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK=0 YES=0 TOOLS=ask BUILD=1
for a in "$@"; do
  case "$a" in
    --check) CHECK=1 ;;
    --yes|-y) YES=1; TOOLS=yes ;;
    --no-tools) TOOLS=no ;;
    --tools) TOOLS=yes ;;
    --no-build) BUILD=0 ;;
    -h|--help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $a (try --help)"; exit 2 ;;
  esac
done

if [ -t 1 ]; then G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; B=$'\033[1m'; D=$'\033[2m'; X=$'\033[0m'; else G= R= Y= B= D= X=; fi
ok()   { printf '  %s✓%s %s\n' "$G" "$X" "$1"; }
bad()  { printf '  %s✗%s %s\n' "$R" "$X" "$1"; }
warn() { printf '  %s!%s %s\n' "$Y" "$X" "$1"; }
head_() { printf '\n%s%s%s\n' "$B" "$1" "$X"; }
have() { command -v "$1" >/dev/null 2>&1; }
ask()  { # ask "question" -> 0 for yes (never prompts without a terminal)
  [ "$YES" = 1 ] && return 0
  [ -t 0 ] || return 1
  local r; read -r -p "$1 [y/N] " r; [[ "$r" =~ ^[Yy] ]]
}

echo "${B}PenNodePaper installer${X}  ${D}($ROOT)${X}"
cd "$ROOT" || exit 1
if [ ! -f package.json ] || ! grep -q '"name": "pennodepaper"' package.json; then
  bad "this folder does not look like PenNodePaper (no package.json). Run the script from inside the downloaded / cloned project."
  exit 1
fi

# ---- which system are we on -------------------------------------------------------------------------------
PM=""
if have apt-get; then PM=apt; elif have dnf; then PM=dnf; elif have pacman; then PM=pacman; elif have zypper; then PM=zypper; elif have brew; then PM=brew; fi
OS="$(uname -s)"
if [ "$OS" = Linux ] && grep -qi microsoft /proc/version 2>/dev/null; then OS="Linux (WSL2)"; fi
echo "  ${D}system: $OS · package manager: ${PM:-none found}${X}"

# ---- 1. Node.js -------------------------------------------------------------------------------------------
head_ "1/4  Node.js"
node_ok=0
if have node && have npm; then
  major="$(node -v | sed 's/^v//; s/\..*//')"
  if [ "${major:-0}" -ge 20 ] 2>/dev/null; then ok "Node $(node -v), npm $(npm -v)"; node_ok=1; else bad "Node $(node -v) is too old; PenNodePaper needs Node 20 or newer"; fi
else
  bad "Node.js / npm not found"
fi
if [ "$node_ok" = 0 ]; then
  echo
  echo "  Install Node.js 20+ first, then run this script again. One of:"
  case "$PM" in
    dnf)    echo "    sudo dnf install nodejs npm" ;;
    pacman) echo "    sudo pacman -S nodejs npm" ;;
    brew)   echo "    brew install node" ;;
    zypper) echo "    sudo zypper install nodejs20 npm20" ;;
    apt)    echo "    (the distro's nodejs is usually too old)" ;;
  esac
  echo "    nvm (any system, no root):  https://github.com/nvm-sh/nvm  then  nvm install --lts"
  echo "    https://nodejs.org/en/download"
  exit 1
fi

# ---- 2. npm install ---------------------------------------------------------------------------------------
head_ "2/4  Project dependencies"
if [ "$CHECK" = 1 ]; then
  if [ -d node_modules/@pnp ] || [ -d node_modules/hono ]; then ok "dependencies are installed"; else warn "dependencies are not installed yet (npm install)"; fi
else
  echo "  ${D}npm install (this takes a minute the first time)…${X}"
  if npm install --no-audit --no-fund; then ok "npm install done"; else bad "npm install failed — see the messages above"; exit 1; fi
fi

# ---- 3. build the web UI ----------------------------------------------------------------------------------
head_ "3/4  Web UI"
if [ "$CHECK" = 1 ]; then
  if [ -f packages/web/dist/index.html ]; then ok "the web UI is built"; else warn "the web UI is not built (only needed for 'npm start'; 'npm run dev' does not need it)"; fi
elif [ "$BUILD" = 1 ]; then
  if npm run build >/dev/null 2>&1; then ok "built (npm start serves it on http://localhost:4317)"; else bad "build failed — run 'npm run build' to see why"; fi
else
  warn "skipped (--no-build)"
fi

# ---- 4. optional helper tools -----------------------------------------------------------------------------
head_ "4/4  Optional helper tools"
# package names per package manager (a case instead of associative arrays: macOS still ships bash 3.2)
pkg_for() { # pkg_for <key>
  case "$PM:$1" in
    apt:weasyprint) echo weasyprint ;;     apt:magick) echo imagemagick ;;     apt:pdftotext) echo poppler-utils ;;   apt:unzip) echo unzip ;;  apt:git) echo git ;;
    dnf:weasyprint) echo weasyprint ;;     dnf:magick) echo ImageMagick ;;     dnf:pdftotext) echo poppler-utils ;;   dnf:unzip) echo unzip ;;  dnf:git) echo git ;;
    pacman:weasyprint) echo python-weasyprint ;; pacman:magick) echo imagemagick ;; pacman:pdftotext) echo poppler ;;   pacman:unzip) echo unzip ;; pacman:git) echo git ;;
    zypper:weasyprint) echo python3-weasyprint ;; zypper:magick) echo ImageMagick ;; zypper:pdftotext) echo poppler-tools ;; zypper:unzip) echo unzip ;; zypper:git) echo git ;;
    brew:weasyprint) echo weasyprint ;;    brew:magick) echo imagemagick ;;    brew:pdftotext) echo poppler ;;        brew:unzip) echo unzip ;; brew:git) echo git ;;
  esac
}
missing_keys=()
tool() { # tool <key> <command...> -- <what it is for>
  local key="$1"; shift
  local found=0 c
  while [ "$1" != "--" ]; do have "$1" && found=1; shift; done
  shift
  if [ "$found" = 1 ]; then ok "$*"; else bad "$*  ${D}(missing)${X}"; missing_keys+=("$key"); fi
}
tool weasyprint weasyprint -- "WeasyPrint — the GM binder as a printable PDF"
tool magick magick convert -- "ImageMagick — fast image thumbnails"
tool pdftotext pdftotext -- "pdftotext (poppler) — importing .pdf notes"
tool unzip unzip -- "unzip — importing .docx notes"
tool git git -- "git — optional local git history of a campaign"
have tar && ok "tar — backups" || { bad "tar — backups (missing; install it with your package manager)"; }

if [ "${#missing_keys[@]}" -gt 0 ] && [ "$CHECK" = 0 ] && [ "$TOOLS" != no ]; then
  pkgs=()
  for k in "${missing_keys[@]}"; do p="$(pkg_for "$k")"; [ -n "$p" ] && pkgs+=("$p"); done
  if [ -z "$PM" ]; then
    warn "no supported package manager found; install the missing tools by hand (docs/INSTALL.md → Other optional tools)"
  else
    case "$PM" in
      apt) cmd=(sudo apt-get install -y "${pkgs[@]}") ;;
      dnf) cmd=(sudo dnf install -y "${pkgs[@]}") ;;
      pacman) cmd=(sudo pacman -S --needed --noconfirm "${pkgs[@]}") ;;
      zypper) cmd=(sudo zypper install -y "${pkgs[@]}") ;;
      brew) cmd=(brew install "${pkgs[@]}") ;;
    esac
    echo
    echo "  To install the missing tools this would run:"
    echo "    ${B}${cmd[*]}${X}"
    if ask "  Run it now?"; then
      if "${cmd[@]}"; then ok "installed"; else
        warn "the package manager reported a problem"
        if printf '%s\n' "${missing_keys[@]}" | grep -qx weasyprint && have pip3; then
          echo "  ${D}trying WeasyPrint through pip instead…${X}"
          pip3 install --user weasyprint && ok "WeasyPrint installed with pip (make sure ~/.local/bin is on your PATH)"
        fi
      fi
    else
      warn "skipped — run the command above any time (or ./scripts/install.sh --tools)"
    fi
  fi
elif [ "${#missing_keys[@]}" -gt 0 ] && [ "$CHECK" = 1 ]; then
  warn "run ./scripts/install.sh (without --check) to install the missing tools"
fi

# ---- what the script leaves to you ------------------------------------------------------------------------
head_ "AI and pictures ${D}(not installed by this script — yours to choose; see docs/INSTALL.md)${X}"
have claude && ok "claude CLI found" || warn "claude CLI not found — the AI chat can use it (docs/INSTALL.md → AI assistants)"
have agy && ok "agy CLI found" || warn "agy CLI not found — an alternative to claude"
if have curl && curl -s -m 2 -o /dev/null http://127.0.0.1:8188/system_stats 2>/dev/null; then ok "ComfyUI answers on 127.0.0.1:8188"; else warn "ComfyUI not reachable on 127.0.0.1:8188 — pictures and painted maps need it (docs/INSTALL.md → ComfyUI)"; fi

head_ "Done"
echo "  Start it from this folder:"
echo "    ${B}npm run dev${X}      then open ${B}http://localhost:5273${X}   (development; reloads on changes)"
echo "    ${B}npm start${X}        then open ${B}http://localhost:4317${X}   (single port; uses the built UI)"
if [ "$OS" = Linux ]; then echo "  A start-menu entry with a tray icon:  ${B}./scripts/install-launcher.sh${X}"; fi
echo "  The first start creates the practice campaign and the welcome tour — it needs none of the optional tools."
exit 0
