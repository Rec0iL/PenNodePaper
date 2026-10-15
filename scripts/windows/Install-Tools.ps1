<#
  Installs what PenNodePaper can use besides Node.js, on Windows (the counterpart of scripts/install.sh):

    Node.js     runs PenNodePaper (only offered when it is missing)
    git         automatic updates of the launcher, optional git history of a campaign
    ImageMagick fast thumbnails of your pictures
    poppler     pdftotext: importing .pdf notes
    WeasyPrint  the GM binder as a printable PDF

  Word (.docx) notes need no extra program: Windows' own tar reads them.
  Everything comes through winget (Windows 10 21H1 / Windows 11), except WeasyPrint, which is its standalone program
  from github.com/Kozea/WeasyPrint/releases, kept in %LOCALAPPDATA%\pennodepaper\tools and added to your PATH.

    Install-Tools.ps1           show what is missing, ask, install
    Install-Tools.ps1 -Check    only report
    Install-Tools.ps1 -Yes      install what is missing without asking

  Run it with:  powershell -NoProfile -ExecutionPolicy Bypass -File Install-Tools.ps1  (or double-click Install-Tools.cmd).
  Keep this file plain ASCII: Windows PowerShell 5.1 reads it as ANSI.
#>
param(
  [switch]$Check,
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'
$ToolsDir = Join-Path $env:LOCALAPPDATA 'pennodepaper\tools'

# ----------------------------------------------------------------- helpers ---

# programs installed a minute ago are on the PATH of the registry, not yet of this window
function Update-SessionPath {
  $seen = @{}
  $all = @()
  foreach ($p in @($env:Path, [Environment]::GetEnvironmentVariable('Path', 'User'), [Environment]::GetEnvironmentVariable('Path', 'Machine'))) {
    foreach ($d in ($p -split ';')) {
      if ($d -and -not $seen.ContainsKey($d.ToLower())) { $seen[$d.ToLower()] = $true; $all += $d }
    }
  }
  $env:Path = $all -join ';'
}

function Add-UserPath([string]$dir) {
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $parts = @(($user -split ';') | Where-Object { $_ })
  if ($parts -notcontains $dir) { [Environment]::SetEnvironmentVariable('Path', (($parts + $dir) -join ';'), 'User') }
  Update-SessionPath
}

# the program on the PATH, or in one of the folders its installer is known to use
function Find-Tool([string]$name, [string[]]$globs = @()) {
  $c = Get-Command "$name.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { return $c.Source }
  foreach ($g in $globs) {
    $hit = Get-ChildItem -Path $g -Filter "$name.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($hit) { return $hit.FullName }
  }
  return $null
}

function Install-WithWinget([string]$id) {
  if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    throw 'winget was not found. Install "App Installer" from the Microsoft Store (or update Windows), then run this again.'
  }
  & winget.exe install --id $id -e --silent --accept-package-agreements --accept-source-agreements
  # "already installed / nothing to upgrade" is not a failure: the check afterwards decides
}

function Install-WeasyPrint {
  $ProgressPreference = 'SilentlyContinue' # the progress bar makes Invoke-WebRequest very slow in Windows PowerShell
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $zip = Join-Path $env:TEMP 'weasyprint-windows-onedir.zip'
  Write-Host '  downloading WeasyPrint (about 30 MB) ...'
  Invoke-WebRequest -UseBasicParsing -OutFile $zip -Uri 'https://github.com/Kozea/WeasyPrint/releases/latest/download/weasyprint-windows-onedir.zip'
  $dest = Join-Path $ToolsDir 'weasyprint'
  if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  Write-Host '  unpacking ...'
  Expand-Archive -Path $zip -DestinationPath $dest -Force
  Remove-Item $zip -Force
  $exe = Get-ChildItem -Path $dest -Filter 'weasyprint.exe' -Recurse | Select-Object -First 1
  if (-not $exe) { throw 'The WeasyPrint download did not contain weasyprint.exe.' }
  Add-UserPath $exe.DirectoryName
}

# ------------------------------------------------------------------- tools ---

$pf = $env:ProgramFiles
$wg = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet'
$tools = @(
  @{ Key = 'node'; Name = 'Node.js'; Why = 'runs PenNodePaper'; Globs = @("$pf\nodejs"); Install = { Install-WithWinget 'OpenJS.NodeJS.LTS' } },
  @{ Key = 'git'; Name = 'git'; Why = 'automatic updates of the launcher'; Globs = @("$pf\Git\cmd"); Install = { Install-WithWinget 'Git.Git' } },
  @{ Key = 'magick'; Name = 'ImageMagick'; Why = 'fast thumbnails of your pictures'; Globs = @("$pf\ImageMagick*"); Install = { Install-WithWinget 'ImageMagick.ImageMagick' } },
  @{ Key = 'pdftotext'; Name = 'poppler (pdftotext)'; Why = 'importing .pdf notes'; Globs = @("$wg\Links", "$wg\Packages\oschwartz10612.Poppler*"); Install = { Install-WithWinget 'oschwartz10612.Poppler' } },
  @{ Key = 'weasyprint'; Name = 'WeasyPrint'; Why = 'the GM binder as a PDF'; Globs = @($ToolsDir); Install = { Install-WeasyPrint } }
)

Update-SessionPath
Write-Host ''
Write-Host 'PenNodePaper - helper tools'
Write-Host '---------------------------'
$missing = @()
foreach ($t in $tools) {
  $found = Find-Tool $t.Key $t.Globs
  $t.Path = $found
  if ($found) { Write-Host ("  [ok]      {0,-20} {1}" -f $t.Name, $found) }
  else { Write-Host ("  [missing] {0,-20} {1}" -f $t.Name, $t.Why); $missing += $t }
}
$tar = Get-Command tar.exe -ErrorAction SilentlyContinue
Write-Host ("  [{0}] {1,-20} {2}" -f $(if ($tar) { 'ok     ' } else { 'missing' }), 'tar (Word import)', $(if ($tar) { 'reads .docx notes, no unzip needed' } else { 'needed for .docx notes and backups - update Windows' }))
Write-Host ''

if ($missing.Count -eq 0) { Write-Host 'Everything is there.'; exit 0 }
if ($Check) { exit 1 }

if (-not $Yes) {
  $names = ($missing | ForEach-Object { $_.Name }) -join ', '
  $a = Read-Host "Install now: $names ? [Y/n]"
  if ($a -and $a -notmatch '^(y|j)') { Write-Host 'Nothing installed.'; exit 0 }
}

$failed = @()
foreach ($t in $missing) {
  Write-Host ''
  Write-Host "== $($t.Name)"
  try {
    & $t.Install
    Update-SessionPath
    $found = Find-Tool $t.Key $t.Globs
    if ($found) {
      # a program found by its installer folder only (not on the PATH yet): put that folder on the PATH
      if (-not (Get-Command "$($t.Key).exe" -ErrorAction SilentlyContinue)) { Add-UserPath (Split-Path $found) }
      Write-Host "  installed: $found"
    } else {
      throw 'It was installed, but the program was not found afterwards. Open a new terminal and run this again with -Check.'
    }
  } catch {
    Write-Host "  FAILED: $($_.Exception.Message)"
    $failed += $t.Name
  }
}

Write-Host ''
if ($failed.Count) { Write-Host "Not installed: $($failed -join ', ')"; exit 1 }
Write-Host 'Done. If PenNodePaper is running, stop it (tray icon -> Stop) and start it again so that it sees the new programs.'
