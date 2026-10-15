@echo off
rem Installs the optional helper tools (ImageMagick, poppler, WeasyPrint, git, Node.js when missing). Works with the default PowerShell script policy.
rem   Install-Tools.cmd           ask first        Install-Tools.cmd -Yes     just do it        Install-Tools.cmd -Check   only report
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Tools.ps1" %*
echo.
pause
