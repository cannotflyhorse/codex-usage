<#
  安装 / 卸载 Codex 用量面板。

  用法：
    pwsh -File install.ps1                       # 装到 %USERPROFILE%\.codex\usage-report
    pwsh -File install.ps1 -TargetDir D:\tools\usage
    pwsh -File install.ps1 -Autostart            # 顺带设置开机自启悬浮窗
    pwsh -File install.ps1 -NoVerify             # 装完不做一次数据自检
    pwsh -File install.ps1 -Uninstall -Force     # 卸载（会先备份改过的 pricing.json）

  参数说明：
    -Force      覆盖已存在的 pricing.json（默认保留用户改过的价格表）
    -Uninstall  卸载，需配合 -Force 才真正删除目录
#>
param(
  [string]$TargetDir,
  [switch]$Autostart,
  [switch]$Uninstall,
  [switch]$Force,
  [switch]$NoVerify
)

$ErrorActionPreference = 'Stop'

$userProfile = [Environment]::GetFolderPath('UserProfile')
if (-not $TargetDir) { $TargetDir = Join-Path $userProfile '.codex\usage-report' }

$skillRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $skillRoot 'assets\usage-report'
$startup = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup 'Codex 用量悬浮窗.lnk'
$port = 8787

function Write-Step([string]$text) { Write-Host "[*] $text" }
function Write-Ok([string]$text) { Write-Host "[OK] $text" -ForegroundColor Green }
function Write-Warn([string]$text) { Write-Host "[!] $text" -ForegroundColor Yellow }

# ---------------------------------------------------------------- 卸载
if ($Uninstall) {
  if (-not (Test-Path $TargetDir)) {
    Write-Warn "没找到安装目录：$TargetDir"
    exit 0
  }
  Write-Step "准备卸载：$TargetDir"
  if (-not $Force) {
    Write-Warn '这会删除整个目录（以及你的悬浮窗设置）。确认无误后重跑并加上 -Force。'
    Write-Host "    pwsh -File install.ps1 -Uninstall -Force"
    exit 1
  }

  $stopCmd = Join-Path $TargetDir 'stop-panel.cmd'
  if (Test-Path $stopCmd) {
    Write-Step '停止后台网页服务'
    & cmd.exe /c "`"$stopCmd`"" | Out-Null
  }
  Write-Warn '如果悬浮窗还开着，请右键它选择“退出”。'

  $pricing = Join-Path $TargetDir 'pricing.json'
  if (Test-Path $pricing) {
    $backup = "$TargetDir.pricing.backup.json"
    Copy-Item -LiteralPath $pricing -Destination $backup -Force
    Write-Ok "价格表已备份到：$backup"
  }
  if (Test-Path $shortcutPath) {
    Remove-Item -LiteralPath $shortcutPath -Force
    Write-Ok '已移除开机自启快捷方式'
  }
  Remove-Item -LiteralPath $TargetDir -Recurse -Force
  Write-Ok '卸载完成'
  exit 0
}

# ---------------------------------------------------------------- 安装
if (-not (Test-Path $source)) {
  throw "找不到要安装的文件：$source"
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Warn 'PATH 里没有 node。面板需要 Node.js 才能运行，请先从 https://nodejs.org 安装。'
}

Write-Step "安装到：$TargetDir"
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

$preserve = @('pricing.json', 'float-panel.state.json')
$copied = 0
$kept = 0
foreach ($file in Get-ChildItem -Path $source -Recurse -File) {
  $relative = $file.FullName.Substring($source.Length).TrimStart('\')
  $destination = Join-Path $TargetDir $relative
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
  if (($preserve -contains $relative) -and (Test-Path $destination) -and -not $Force) {
    $kept++
    continue
  }
  Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
  $copied++
}
Write-Ok "已复制 $copied 个文件$(if ($kept -gt 0) { "，保留 $kept 个已有配置（pricing.json / 窗口位置）" })"

if ($Autostart) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = Join-Path $TargetDir 'float-panel.cmd'
  $shortcut.WorkingDirectory = $TargetDir
  $shortcut.Description = 'Codex 用量悬浮窗'
  $shortcut.Save()
  Write-Ok "已设置开机自启：$shortcutPath"
}

if (-not $NoVerify -and $node) {
  Write-Step '跑一次数据自检'
  & node (Join-Path $TargetDir 'server.js') --once
}

Write-Host ''
Write-Ok '安装完成。接下来由你自己启动（窗口必须属于你的账户才看得见）：'
Write-Host "    悬浮窗：双击 $(Join-Path $TargetDir 'float-panel.cmd')"
Write-Host "    网页面板：双击 $(Join-Path $TargetDir 'start-panel.cmd')  然后打开 http://127.0.0.1:$port"
if (-not $Autostart) {
  Write-Host "    想开机自启：重跑安装脚本并加 -Autostart"
}
