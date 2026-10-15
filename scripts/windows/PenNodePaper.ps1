<#
  PenNodePaper launcher + tray icon for Windows (the counterpart of scripts/pennodepaper.sh and pennodepaper-tray.py).
  Needs nothing but Node.js: the tray icon is built from what Windows has (PowerShell + Windows Forms).

    PenNodePaper.ps1 start        start the server in the background (builds the UI first if needed), open the browser, show the tray icon
    PenNodePaper.ps1 start-lan    the same, but other devices on your network can use it too (an access code is needed)
    PenNodePaper.ps1 stop         stop the server
    PenNodePaper.ps1 open         open the browser (starts the server if it is not running)
    PenNodePaper.ps1 status       print whether it runs
    PenNodePaper.ps1 lan-info     show the address and access code for other devices
    PenNodePaper.ps1 tray         run just the tray icon (status dot, start / stop, LAN mode, address and code)
    PenNodePaper.ps1 selftest     check what this script needs and print it (run it from a terminal)

  Run it with:  powershell -NoProfile -ExecutionPolicy Bypass -File PenNodePaper.ps1 start
  (the shortcuts made by install-launcher.ps1 do exactly that, so the PowerShell script policy is not in the way).
  PNP_NO_TRAY=1 leaves the tray icon out. PNP_PORT changes the port (default 4317).
  When it starts the server it first looks for a new version (git fetch) and installs it (git pull --ff-only, npm install
  when a package list changed, the UI is rebuilt). Nothing is touched when there are changes of your own, when you are
  offline, or when the server already runs. PNP_NO_UPDATE=1 turns the update off.
  Keep this file plain ASCII: Windows PowerShell 5.1 reads it as ANSI.
#>
param(
  [string]$Command = 'tray',
  [string]$Message = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Port = if ($env:PNP_PORT) { [int]$env:PNP_PORT } else { 4317 }
$Url = "http://localhost:$Port"
$State = Join-Path $env:LOCALAPPDATA 'pennodepaper'
$PidFile = Join-Path $State 'server.pid'
$Log = Join-Path $State 'server.log'
$NoticeFile = Join-Path $State 'notice.txt'
$IcoPath = Join-Path $PSScriptRoot 'pennodepaper.ico'
$PsExe = (Get-Process -Id $PID).Path
New-Item -ItemType Directory -Force -Path $State | Out-Null

# ----------------------------------------------------------------- helpers ---

function Show-Box([string]$text, [string]$kind = 'Information') {
  [void][System.Windows.Forms.MessageBox]::Show($text, 'PenNodePaper', 'OK', $kind)
}

function Test-Port {
  $c = New-Object System.Net.Sockets.TcpClient
  try {
    $a = $c.BeginConnect('127.0.0.1', $Port, $null, $null)
    return ($a.AsyncWaitHandle.WaitOne(400) -and $c.Connected)
  } catch { return $false } finally { $c.Close() }
}

# $null when the server is down, else what /api/lan says (this computer is never asked for a login)
function Get-Status {
  if (-not (Test-Port)) { return $null }
  try { return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/lan" -TimeoutSec 3 } catch { return $null }
}

function Get-Mode($st) {
  if ($null -eq $st) { return 'down' }
  if ($st.enabled) { return 'lan' }
  return 'local'
}

function Get-ListenerPid {
  $c = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($c.Count -gt 0) { return [int]$c[0].OwningProcess }
  return $null
}

function Wait-Port([bool]$up, [int]$seconds) {
  $end = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $end) {
    if ((Test-Port) -eq $up) { return $true }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

function Test-NeedsBuild {
  $idx = Join-Path $Root 'packages\web\dist\index.html'
  if (-not (Test-Path $idx)) { return $true }
  $t = (Get-Item $idx).LastWriteTime
  foreach ($p in @('packages\web\src', 'packages\web\index.html', 'packages\shared')) {
    $full = Join-Path $Root $p
    if (-not (Test-Path $full)) { continue }
    $newer = Get-ChildItem $full -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.LastWriteTime -gt $t } | Select-Object -First 1
    if ($newer) { return $true }
  }
  return $false
}

function Invoke-Npm([string[]]$npmArgs, [string]$what) {
  $p = Start-Process -FilePath 'npm.cmd' -ArgumentList $npmArgs -WorkingDirectory $Root -WindowStyle Hidden -Wait -PassThru `
    -RedirectStandardOutput $Log -RedirectStandardError "$Log.err"
  if ($p.ExitCode -ne 0) { throw "$what failed - see $Log and $Log.err" }
}

# git with a time limit and without any prompt; { Ok; Out; Err }
function Invoke-Git([string[]]$gitArgs, [int]$timeoutMs = 30000) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'git.exe'
  $psi.Arguments = (($gitArgs | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' ')
  $psi.WorkingDirectory = $Root
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.EnvironmentVariables['GIT_TERMINAL_PROMPT'] = '0'
  $p = [System.Diagnostics.Process]::Start($psi)
  $out = $p.StandardOutput.ReadToEndAsync()
  $err = $p.StandardError.ReadToEndAsync()
  if (-not $p.WaitForExit($timeoutMs)) {
    try { $p.Kill() } catch { }
    return @{ Ok = $false; Out = ''; Err = 'timed out' }
  }
  return @{ Ok = ($p.ExitCode -eq 0); Out = $out.Result.Trim(); Err = $err.Result.Trim() }
}

# a line for the tray icon to show as a balloon (the tray may start after this script has written it)
function Set-Notice([string]$text) {
  Set-Content -Path $NoticeFile -Value $text
  Add-Content -Path (Join-Path $State 'launcher.log') -Value "$(Get-Date -Format s) $text"
}

# Looks for a new version and installs it. Never stops the start: whatever is wrong, the version that is here is started.
function Update-App {
  if ($env:PNP_NO_UPDATE -eq '1') { return }
  try {
    if (-not (Test-Path (Join-Path $Root '.git'))) { return }
    if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) { return }
    if (-not (Invoke-Git @('fetch', '--quiet')).Ok) { return } # offline
    $n = Invoke-Git @('rev-list', '--count', 'HEAD..@{u}')
    if (-not $n.Ok -or -not $n.Out -or [int]$n.Out -eq 0) { return }
    $dirty = Invoke-Git @('status', '--porcelain', '--untracked-files=no')
    if ($dirty.Out) { Set-Notice 'An update is available, but this copy has changes of its own - it was not updated.'; return }
    $before = (Invoke-Git @('rev-parse', 'HEAD')).Out
    $pull = Invoke-Git @('pull', '--ff-only', '--quiet') 180000
    if (-not $pull.Ok) { Set-Notice "The update did not work: $($pull.Err)"; return }
    $changed = (Invoke-Git @('diff', '--name-only', $before, 'HEAD')).Out
    if ($changed -match '(^|/)package(-lock)?\.json') { Invoke-Npm @('install') 'npm install' }
    Set-Notice "PenNodePaper was updated ($($n.Out) new change$(if ([int]$n.Out -ne 1) { 's' }))."
  } catch {
    Add-Content -Path (Join-Path $State 'launcher.log') -Value "$(Get-Date -Format s) update skipped: $($_.Exception.Message)"
  }
}

# run this script again (hidden, detached) with another command: the tray menu and the start-up use it
function Start-Self([string[]]$more) {
  $a = @('-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$PSCommandPath`"") + $more
  Start-Process -FilePath $PsExe -ArgumentList $a -WindowStyle Hidden | Out-Null
}

function Start-TrayProcess([string]$msg = '') {
  if ($env:PNP_NO_TRAY -eq '1') { return }
  if ($msg) { Start-Self @('tray', '-Message', "`"$msg`"") } else { Start-Self @('tray') }
}

# --------------------------------------------------------------- the server ---

# taskkill through Start-Process: a native program's stderr would turn into a script error under $ErrorActionPreference = 'Stop'
function Stop-Tree([int]$id) {
  Start-Process -FilePath 'taskkill.exe' -ArgumentList @('/PID', "$id", '/T', '/F') -WindowStyle Hidden -Wait | Out-Null
}

function Stop-Server {
  $target = $null
  if (Test-Path $PidFile) {
    $saved = [int](Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($saved -and (Get-Process -Id $saved -ErrorAction SilentlyContinue)) { $target = $saved }
  }
  if ($target) { Stop-Tree $target }
  # started some other way (npm run dev): stop it only when it is this folder's server
  if (Test-Port) {
    $lp = Get-ListenerPid
    if ($lp) {
      $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$lp" -ErrorAction SilentlyContinue
      if ($cim -and $cim.CommandLine -and $cim.CommandLine.ToLower().Contains($Root.ToLower())) {
        Stop-Tree $lp
      }
    }
  }
  Remove-Item $PidFile -ErrorAction SilentlyContinue
  if (-not (Wait-Port $false 10)) { throw "Could not stop the server on port $Port." }
}

function Start-Server([bool]$lan) {
  if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw 'Node.js was not found. Install it from https://nodejs.org (the LTS version), then try again.'
  }
  if (Test-Port) {
    $mode = Get-Mode (Get-Status)
    if (($mode -eq 'lan') -eq $lan) { return }
    Stop-Server
  } else {
    Update-App
  }
  if (-not (Test-Path (Join-Path $Root 'node_modules'))) { Invoke-Npm @('install') 'npm install' }
  if (Test-NeedsBuild) { Invoke-Npm @('run', 'build') 'Building the UI' }
  $env:PNP_LAN = if ($lan) { '1' } else { '0' }
  $p = Start-Process -FilePath 'npm.cmd' -ArgumentList 'start' -WorkingDirectory $Root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $Log -RedirectStandardError "$Log.err"
  Set-Content -Path $PidFile -Value $p.Id
  if (-not (Wait-Port $true 40)) { throw "The server did not come up - see $Log and $Log.err" }
}

function Invoke-Start([bool]$lan) {
  Start-TrayProcess 'Starting PenNodePaper (looking for updates; the first start and updates take a minute)...'
  Start-Server $lan
  Start-Process $Url
}

function Show-LanInfo {
  $st = Get-Status
  if ($null -eq $st) { Show-Box 'PenNodePaper is not running.'; return }
  if (-not $st.enabled) {
    Show-Box "LAN mode is OFF - only this computer can use PenNodePaper.`n`nStart it in LAN mode from the Start menu or the tray icon."
    return
  }
  $urls = @($st.urls)
  if ($urls.Count -eq 0) { $urls = @('(no network address found)') }
  Show-Box ("Open on the other device:`n  " + ($urls -join "`n  ") + "`n`nAccess code:`n  " + $st.code + "`n`n(typed once on that device; capitals, spaces and dashes do not matter)")
}

# ----------------------------------------------------------------- the tray ---

function New-StatusIcon([string]$mode) {
  if (-not (Test-Path $IcoPath)) { return [System.Drawing.SystemIcons]::Application }
  $base = New-Object System.Drawing.Icon($IcoPath, 32, 32)
  $bmp = $base.ToBitmap()
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $hex = switch ($mode) { 'local' { '#4ade80' } 'lan' { '#60a5fa' } default { '#7b8190' } }
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($hex))
  $pen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#0f1117'), 1.5)
  $g.FillEllipse($brush, 17, 17, 14, 14)
  $g.DrawEllipse($pen, 17, 17, 14, 14)
  $g.Dispose(); $brush.Dispose(); $pen.Dispose()
  return [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}

function Get-Header($st) {
  switch (Get-Mode $st) {
    'down' { return 'PenNodePaper - stopped' }
    'local' { return 'PenNodePaper - running (only this computer)' }
    default { return 'PenNodePaper - running, open to your network' }
  }
}

function Add-MenuItem([string]$text, [scriptblock]$action, [bool]$enabled = $true) {
  $mi = New-Object System.Windows.Forms.ToolStripMenuItem($text)
  $mi.Enabled = $enabled
  if ($action) {
    $mi.Tag = $action
    $mi.add_Click({
      param($sender, $e)
      & $sender.Tag
    })
  }
  [void]$script:Menu.Items.Add($mi)
  return $mi
}

function Build-Menu {
  $st = $script:St
  $mode = Get-Mode $st
  $script:Notify.Text = (Get-Header $st).Substring(0, [Math]::Min(63, (Get-Header $st).Length))
  $old = $script:Notify.Icon
  $script:Notify.Icon = New-StatusIcon $mode
  if ($old -and $old -ne [System.Drawing.SystemIcons]::Application) { $old.Dispose() }
  $script:Menu.Items.Clear()
  [void](Add-MenuItem (Get-Header $st) $null $false)
  [void](Add-MenuItem 'Open PenNodePaper' { Start-Self @('open') })
  [void]$script:Menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
  if ($mode -eq 'down') {
    [void](Add-MenuItem 'Start' { Start-Self @('start') })
    [void](Add-MenuItem 'Start - open to other devices (LAN)' { Start-Self @('start-lan') })
  } else {
    [void](Add-MenuItem 'Stop' { Start-Self @('stop') })
    $lan = Add-MenuItem 'Allow other devices on my network (LAN)' { if ((Get-Mode $script:St) -eq 'lan') { Start-Self @('start') } else { Start-Self @('start-lan') } }
    $lan.Checked = ($mode -eq 'lan')
  }
  if ($mode -eq 'lan') {
    [void]$script:Menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
    $urls = @($st.urls)
    if ($urls.Count -gt 0) {
      [void](Add-MenuItem ("Copy address  " + $urls[0]) { [System.Windows.Forms.Clipboard]::SetText([string]@($script:St.urls)[0]); $script:Notify.ShowBalloonTip(1500, 'PenNodePaper', 'Copied', 'Info') })
    }
    if ($st.code) {
      [void](Add-MenuItem ("Copy access code  " + $st.code) { [System.Windows.Forms.Clipboard]::SetText([string]$script:St.code); $script:Notify.ShowBalloonTip(1500, 'PenNodePaper', 'Copied', 'Info') })
    }
    [void](Add-MenuItem 'Show address and code...' { Show-LanInfo })
  }
  [void]$script:Menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
  [void](Add-MenuItem 'Quit tray icon' { $script:Notify.Visible = $false; [System.Windows.Forms.Application]::Exit() })
}

# a message the launcher left for the user (an update was installed, ...); older than ten minutes is not news any more
function Show-Notice {
  if (-not (Test-Path $NoticeFile)) { return }
  $age = (Get-Date) - (Get-Item $NoticeFile).LastWriteTime
  $text = (Get-Content $NoticeFile -Raw).Trim()
  Remove-Item $NoticeFile -ErrorAction SilentlyContinue
  if ($text -and $age.TotalMinutes -lt 10) { $script:Notify.ShowBalloonTip(8000, 'PenNodePaper', $text, 'Info') }
}

function Update-Tray {
  $st = Get-Status
  $sig = if ($null -eq $st) { 'down' } else { ($st | ConvertTo-Json -Compress) }
  if ($sig -eq $script:Sig) { return }
  $script:Sig = $sig
  $script:St = $st
  Build-Menu
}

function Invoke-Tray {
  [System.Windows.Forms.Application]::EnableVisualStyles()
  $env:PNP_NO_TRAY = '1' # what this icon starts must not start another icon
  $script:Mutex = New-Object System.Threading.Mutex($false, 'Local\PenNodePaperTray')
  if (-not $script:Mutex.WaitOne(0, $false)) { return } # one tray icon at a time
  $script:Sig = $null
  $script:St = $null
  $script:Menu = New-Object System.Windows.Forms.ContextMenuStrip
  $script:Notify = New-Object System.Windows.Forms.NotifyIcon
  $script:Notify.ContextMenuStrip = $script:Menu
  $script:Notify.add_MouseClick({
    param($sender, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Start-Self @('open') }
  })
  Update-Tray
  $script:Notify.Visible = $true
  if ($Message) { $script:Notify.ShowBalloonTip(5000, 'PenNodePaper', $Message, 'Info') } else { Show-Notice }
  $script:Timer = New-Object System.Windows.Forms.Timer
  $script:Timer.Interval = 3000
  $script:Timer.add_Tick({ try { Update-Tray; Show-Notice } catch { } })
  $script:Timer.Start()
  [System.Windows.Forms.Application]::Run()
  $script:Notify.Dispose()
}

# ------------------------------------------------------------------- run ---

function Invoke-SelfTest {
  Write-Host "Folder      : $Root"
  Write-Host "Port        : $Port"
  Write-Host "Node        : $((Get-Command node.exe -ErrorAction SilentlyContinue).Source)"
  Write-Host "npm.cmd     : $((Get-Command npm.cmd -ErrorAction SilentlyContinue).Source)"
  Write-Host "node_modules: $(Test-Path (Join-Path $Root 'node_modules'))"
  Write-Host "UI built    : $(-not (Test-NeedsBuild))"
  Write-Host "Icon file   : $(Test-Path $IcoPath)"
  Write-Host "Updates     : $(if ($env:PNP_NO_UPDATE -eq '1') { 'off (PNP_NO_UPDATE)' } elseif ((Test-Path (Join-Path $Root '.git')) -and (Get-Command git.exe -ErrorAction SilentlyContinue)) { 'on (git)' } else { 'not possible here (no git checkout / no git.exe)' })"
  Write-Host "State/log   : $State"
  $st = Get-Status
  Write-Host "Server      : $(Get-Header $st)"
  foreach ($m in 'down', 'local', 'lan') {
    $ic = New-StatusIcon $m
    Write-Host ("Tray icon   : {0,-5} {1}" -f $m, $(if ($ic) { 'ok' } else { 'FAILED' }))
  }
}

try {
  switch ($Command.ToLower()) {
    'start' { Invoke-Start $false }
    'start-lan' { Invoke-Start $true }
    'stop' { Stop-Server }
    'open' { if (Test-Port) { Start-Process $Url; Start-TrayProcess } else { Invoke-Start $false } }
    'status' { $st = Get-Status; Write-Host (Get-Header $st); if ($null -eq $st) { exit 1 } }
    'lan-info' { Show-LanInfo }
    'tray' { Invoke-Tray }
    'selftest' { Invoke-SelfTest }
    default { Write-Host 'usage: PenNodePaper.ps1 start | start-lan | stop | open | status | lan-info | tray | selftest'; exit 2 }
  }
} catch {
  $text = $_.Exception.Message
  Add-Content -Path (Join-Path $State 'launcher.log') -Value "$(Get-Date -Format s) [$Command] $text"
  Show-Box $text 'Error'
  exit 1
}
