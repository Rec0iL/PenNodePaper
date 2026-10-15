@echo off
rem Starts PenNodePaper (tray icon, browser) without installing anything. Double-click it, or: PenNodePaper.cmd start-lan | stop | open
set "ARG=%~1"
if "%ARG%"=="" set "ARG=start"
start "" /min powershell -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0PenNodePaper.ps1" %ARG%
