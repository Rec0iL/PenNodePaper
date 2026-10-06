#!/usr/bin/env bash
# Install a start-menu entry (right-click: LAN mode, LAN address and code, open, stop, tray icon) for the current user. Linux desktops only.
set -eu
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
APPS="$DATA/applications"
ICONS="$DATA/icons/hicolor/scalable/apps"
mkdir -p "$APPS" "$ICONS"
chmod +x "$ROOT/scripts/pennodepaper.sh"
cp "$ROOT/scripts/pennodepaper.svg" "$ICONS/pennodepaper.svg"
cat >"$APPS/pennodepaper.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=PenNodePaper
GenericName=Pen & paper story builder
Comment=AI-assisted world and story building for pen & paper
Exec="$ROOT/scripts/pennodepaper.sh" start
Icon=pennodepaper
Terminal=false
Categories=Game;RolePlaying;
Keywords=rpg;ttrpg;pen and paper;story;campaign;
Actions=start-lan;lan-info;open;stop;tray;

[Desktop Action start-lan]
Name=Start in LAN mode (use from other devices)
Exec="$ROOT/scripts/pennodepaper.sh" start-lan

[Desktop Action lan-info]
Name=Show LAN address and access code
Exec="$ROOT/scripts/pennodepaper.sh" lan-info

[Desktop Action open]
Name=Open in browser
Exec="$ROOT/scripts/pennodepaper.sh" open

[Desktop Action stop]
Name=Stop PenNodePaper
Exec="$ROOT/scripts/pennodepaper.sh" stop

[Desktop Action tray]
Name=Show tray icon
Exec="$ROOT/scripts/pennodepaper.sh" tray
DESKTOP
command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t "$DATA/icons/hicolor" 2>/dev/null || true
echo "Installed: $APPS/pennodepaper.desktop"
