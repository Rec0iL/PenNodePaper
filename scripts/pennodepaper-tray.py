#!/usr/bin/env python3
"""PenNodePaper tray icon: see at a glance whether the server runs (and for whom), start / stop it, switch LAN mode,
copy the address and access code for another device, look for a new version and install it. Needs PyQt6 or PySide6;
one instance at a time. Linux and macOS.

  pennodepaper-tray.py            run the tray icon
  pennodepaper-tray.py --probe    exit 0 if this Python can run it (Qt importable)
  pennodepaper-tray.py --selftest build the menu once, print what it would show, exit (no tray needed)
"""
import json
import os
import subprocess
import sys
import tempfile
import urllib.request

try:
    from PyQt6.QtCore import QLockFile, QProcess, QProcessEnvironment, QSize, Qt, QTimer
    from PyQt6.QtGui import QAction, QColor, QIcon, QPainter, QPixmap
    from PyQt6.QtWidgets import QApplication, QMenu, QMessageBox, QSystemTrayIcon
except ImportError:  # PySide6 has the same API for what we use
    from PySide6.QtCore import QLockFile, QProcess, QProcessEnvironment, QSize, Qt, QTimer
    from PySide6.QtGui import QAction, QColor, QIcon, QPainter, QPixmap
    from PySide6.QtWidgets import QApplication, QMenu, QMessageBox, QSystemTrayIcon

if "--probe" in sys.argv:  # the launcher asks: did the Qt imports above work with this interpreter?
    sys.exit(0)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CTL = os.path.join(ROOT, "scripts", "pennodepaper.sh")
SVG = os.path.join(ROOT, "scripts", "pennodepaper.svg")
PORT = int(os.environ.get("PNP_PORT", "4317"))
POLL_MS = 3000
STATE = os.path.join(os.environ.get("XDG_STATE_HOME") or os.path.expanduser("~/.local/state"), "pennodepaper")
UPDATES = os.path.join(STATE, "updates")  # how many new changes the last look found (written by pennodepaper.sh)
CHECK_EVERY_MS = 6 * 3600 * 1000

GREY, GREEN, BLUE = QColor("#7b8190"), QColor("#4ade80"), QColor("#60a5fa")
LOCK = None  # the one-instance lock (released before the icon restarts itself after an update)


def status():
    """None when the server is down, else what /api/lan says (this computer is never asked for a login)."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/lan", timeout=1.2) as r:
            return json.load(r)
    except Exception:
        return None


def pending_updates():
    """New changes the last look for a new version found (0 = up to date or not looked yet)."""
    try:
        with open(UPDATES) as f:
            return max(0, int(f.read().strip() or 0))
    except (OSError, ValueError):
        return 0


def version():
    try:
        return subprocess.run([CTL, "version"], capture_output=True, text=True, timeout=5).stdout.strip() or "unknown"
    except Exception:
        return "unknown"


def ctl(*args):
    """Run the launcher without waiting; it must not start another tray."""
    env = dict(os.environ, PNP_NO_TRAY="1")
    subprocess.Popen([CTL, *args], env=env, start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def make_icon(state):
    """The app icon with a status dot: grey = stopped, green = running here only, blue = open to the network."""
    base = QIcon(SVG).pixmap(QSize(64, 64))
    pm = QPixmap(64, 64)
    pm.fill(Qt.GlobalColor.transparent)
    p = QPainter(pm)
    p.setOpacity(0.45 if state == "down" else 1.0)
    p.drawPixmap(0, 0, base)
    p.setOpacity(1.0)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    p.setBrush({"down": GREY, "local": GREEN, "lan": BLUE}[state])
    p.setPen(QColor("#0f1117"))
    p.drawEllipse(38, 38, 24, 24)
    p.end()
    return QIcon(pm)


def mode_of(st):
    return "down" if st is None else ("lan" if st.get("enabled") else "local")


def describe(st):
    """What the menu header and tooltip say."""
    m = mode_of(st)
    if m == "down":
        return "PenNodePaper — stopped"
    if m == "local":
        return "PenNodePaper — running (only this computer)"
    urls = st.get("urls") or []
    return "PenNodePaper — running, open to your network" + (f"\n{urls[0]}" if urls else "")


class Tray:
    def __init__(self, app):
        self.app = app
        self.st = None
        self.state = None
        self.tray = QSystemTrayIcon()
        self.menu = QMenu()
        self.tray.setContextMenu(self.menu)
        self.tray.activated.connect(self.on_activated)
        self.version = version()
        self.job = None  # the look for / install of an update that is running (QProcess)
        self.timer = QTimer()
        self.timer.timeout.connect(self.refresh)
        self.refresh()
        self.timer.start(POLL_MS)
        self.tray.show()
        # look for a new version now and then, quietly: the menu offers it when there is one
        self.checker = QTimer()
        self.checker.timeout.connect(lambda: self.check(quiet=True))
        self.checker.start(CHECK_EVERY_MS)
        QTimer.singleShot(20_000, lambda: self.check(quiet=True))

    def on_activated(self, reason):
        if reason == QSystemTrayIcon.ActivationReason.Trigger:  # left click
            ctl("open")

    def refresh(self):
        st = status()
        sig = json.dumps([st, pending_updates(), self.version, self.job is not None], sort_keys=True)
        if sig == getattr(self, "_sig", None):
            return
        self._sig, self.st = sig, st
        self.build()

    def build(self):
        st, m = self.st, mode_of(self.st)
        self.state = m
        self.tray.setIcon(make_icon(m))
        self.tray.setToolTip(describe(st))
        menu = self.menu
        menu.clear()
        head = QAction(describe(st).split("\n")[0], menu)
        head.setEnabled(False)
        menu.addAction(head)
        menu.addAction("Open PenNodePaper", lambda: ctl("open"))
        n = pending_updates()
        if self.job is not None:
            busy = QAction("Working on the update…", menu)
            busy.setEnabled(False)
            menu.addAction(busy)
        elif n:
            menu.addAction(f"Update now — {n} new change{'s' if n != 1 else ''}", self.confirm_update)
        menu.addSeparator()
        if m == "down":
            menu.addAction("Start", lambda: ctl("start"))
            menu.addAction("Start — open to other devices (LAN)", lambda: ctl("start-lan"))
        else:
            menu.addAction("Stop", lambda: ctl("stop"))
            lan = QAction("Allow other devices on my network (LAN)", menu)
            lan.setCheckable(True)
            lan.setChecked(m == "lan")
            lan.triggered.connect(lambda checked: self.set_lan(checked))
            menu.addAction(lan)
        if m == "lan":
            menu.addSeparator()
            urls = st.get("urls") or []
            code = st.get("code", "")
            if urls:
                menu.addAction(f"Copy address  {urls[0]}", lambda: self.copy(urls[0]))
            if code:
                menu.addAction(f"Copy access code  {code}", lambda: self.copy(code))
            menu.addAction("Show address and code…", self.show_lan)
        menu.addSeparator()
        ver = QAction(f"Version {self.version}", menu)
        ver.setEnabled(False)
        menu.addAction(ver)
        check = menu.addAction("Check for updates", lambda: self.check(quiet=False))
        check.setEnabled(self.job is None)
        menu.addAction("Quit tray icon", self.app.quit)

    # ---- updates: pennodepaper.sh looks (git fetch) and installs (git pull, npm install, restart) ----
    def run_ctl(self, args, done):
        """Run the launcher in the background (the menu stays usable); done(exit code, last line it printed)."""
        if self.job is not None:
            return
        p = QProcess()
        env = QProcessEnvironment.systemEnvironment()
        env.insert("PNP_NO_TRAY", "1")
        p.setProcessEnvironment(env)
        p.setProcessChannelMode(QProcess.ProcessChannelMode.MergedChannels)

        def finished(code, _status):
            out = bytes(p.readAllStandardOutput()).decode("utf-8", "replace").strip().splitlines()
            self.job = None
            self._sig = None  # rebuild the menu
            self.refresh()
            done(code, out[-1] if out else "")

        p.finished.connect(finished)
        self.job = p
        self._sig = None
        self.refresh()
        p.start(CTL, args)

    def check(self, quiet):
        def done(code, line):
            if quiet:
                return
            n = pending_updates()
            if code != 0:
                self.tray.showMessage("PenNodePaper", line or "Could not look for updates.")
            elif n:
                self.confirm_update()
            else:
                self.tray.showMessage("PenNodePaper", f"Up to date ({self.version}).")
        self.run_ctl(["check-update", "--quiet"], done)

    def confirm_update(self):
        n = pending_updates()
        running = mode_of(self.st) != "down"
        box = QMessageBox()
        box.setWindowTitle("PenNodePaper — update")
        box.setText(f"A new version is ready ({n} new change{'s' if n != 1 else ''}). Install it now?")
        box.setInformativeText("PenNodePaper restarts for it; an AI or image job that is running is stopped. Your campaigns are not touched." if running else "Your campaigns are not touched.")
        box.setStandardButtons(QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
        if box.exec() != QMessageBox.StandardButton.Yes:
            return
        self.tray.showMessage("PenNodePaper", "Updating…")
        before = os.path.getmtime(os.path.abspath(__file__))

        def done(code, line):
            self.version = version()
            self._sig = None
            self.refresh()
            self.tray.showMessage("PenNodePaper", line or ("Updated." if code == 0 else "The update did not work."))
            # the update may have brought a new tray icon: start that one instead of this
            if code == 0 and os.path.getmtime(os.path.abspath(__file__)) != before:
                QTimer.singleShot(4000, self.restart_self)
        self.run_ctl(["update"], done)

    def restart_self(self):
        self.tray.hide()
        LOCK.unlock()
        os.execv(sys.executable, [sys.executable, os.path.abspath(__file__)])

    def set_lan(self, on):
        self.tray.showMessage("PenNodePaper", "Restarting in LAN mode…" if on else "Restarting for this computer only…")
        ctl("start-lan" if on else "start")

    def copy(self, text):
        self.app.clipboard().setText(text)
        self.tray.showMessage("PenNodePaper", "Copied")

    def show_lan(self):
        st = self.st or {}
        urls = "\n".join(st.get("urls") or ["(no network address found)"])
        box = QMessageBox()
        box.setWindowTitle("PenNodePaper — LAN")
        box.setText(f"Open on the other device:\n{urls}\n\nAccess code:\n{st.get('code', '?')}")
        box.setInformativeText("Typed once on that device; capitals, spaces and dashes do not matter.")
        box.exec()


def main():
    if "--selftest" in sys.argv:
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)
    app.setApplicationName("PenNodePaper")
    if "--selftest" in sys.argv:
        st = status()
        for state in ("down", "local", "lan"):
            fake = None if state == "down" else {"enabled": state == "lan", "urls": ["http://192.168.0.5:4317"], "code": "ABCD-EFGH-JKLM-NPQR"}
            t = Tray.__new__(Tray)
            t.app, t.st, t.version, t.job = app, fake, version(), None
            t.tray, t.menu = QSystemTrayIcon(), QMenu()
            t.build()
            labels = [a.text() for a in t.menu.actions() if a.text()]
            print(f"[{state}] icon={'ok' if not make_icon(state).isNull() else 'EMPTY'} | {' | '.join(labels)}")
        print("live status:", describe(st).split("\n")[0])
        return 0
    if not QSystemTrayIcon.isSystemTrayAvailable():
        print("no system tray available on this desktop", file=sys.stderr)
        return 1
    global LOCK
    LOCK = QLockFile(os.path.join(tempfile.gettempdir(), f"pennodepaper-tray-{os.getuid()}.lock"))
    LOCK.setStaleLockTime(0)
    if not LOCK.tryLock(100):
        return 0  # already running
    tray = Tray(app)  # noqa: F841 (kept alive)
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
