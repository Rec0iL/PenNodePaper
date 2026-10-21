<#
  Adds PenNodePaper to the Windows Start menu (and optionally the desktop) for the current user:
    PenNodePaper                  start it (tray icon, browser opens)
    PenNodePaper (LAN mode)       start it so other devices on your network can use it too
    Stop PenNodePaper
  Use:  powershell -NoProfile -ExecutionPolicy Bypass -File install-launcher.ps1 [-Desktop] [-Uninstall]
  (or double-click Install-Launcher.cmd). Keep this file plain ASCII.
#>
param(
  [switch]$Desktop,
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
$launcher = Join-Path $here 'PenNodePaper.ps1'
$ico = Join-Path $here 'pennodepaper.ico'
$root = (Resolve-Path (Join-Path $here '..\..')).Path
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$programs = [Environment]::GetFolderPath('Programs')
$desktopDir = [Environment]::GetFolderPath('Desktop')

$entries = @(
  @{ Name = 'PenNodePaper'; Arg = 'start'; Text = 'Start PenNodePaper: tray icon, opens in the browser' },
  @{ Name = 'PenNodePaper (LAN mode)'; Arg = 'start-lan'; Text = 'Start so that other devices on your network can use it (access code needed)' },
  @{ Name = 'Stop PenNodePaper'; Arg = 'stop'; Text = 'Stop the PenNodePaper server' }
)

if ($Uninstall) {
  foreach ($e in $entries) {
    foreach ($dir in @($programs, $desktopDir)) {
      $f = Join-Path $dir "$($e.Name).lnk"
      if (Test-Path $f) { Remove-Item $f; Write-Host "Removed $f" }
    }
  }
  return
}

$ws = New-Object -ComObject WScript.Shell
function New-Link([string]$dir, $e) {
  $f = Join-Path $dir "$($e.Name).lnk"
  $l = $ws.CreateShortcut($f)
  $l.TargetPath = $ps
  $l.Arguments = "-NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`" $($e.Arg)"
  $l.WorkingDirectory = $root
  $l.IconLocation = "$ico,0"
  $l.Description = $e.Text
  $l.WindowStyle = 7
  $l.Save()
  Write-Host "Created $f"
}

foreach ($e in $entries) { New-Link $programs $e }
if ($Desktop) { New-Link $desktopDir $entries[0] }
Write-Host ''
Write-Host 'Done. Open the Start menu and type "PenNodePaper".'
