@echo off
rem Adds PenNodePaper to the Start menu. Asks whether you also want a desktop shortcut. Works with the default PowerShell script policy.
echo.
echo Adding PenNodePaper to the Start menu ...
echo.
choice /C YN /M "Also put a shortcut on the desktop"
if errorlevel 2 (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-launcher.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-launcher.ps1" -Desktop
)
echo.
pause
