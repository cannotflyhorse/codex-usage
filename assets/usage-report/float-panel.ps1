#Requires -Version 5.1
<#
  Codex 用量悬浮窗（WPF，置顶、可拖动、托盘菜单）

  用法：
    pwsh -File float-panel.ps1            # 或双击 float-panel.cmd
    pwsh -File float-panel.ps1 -Once      # 只输出一次数据，不开窗（自检）

  数据来自同目录的 server.js（未运行时自动后台拉起）。
#>
param(
  [string]$ServerUrl = 'http://127.0.0.1:8787',
  [int]$RefreshMs = 2000,
  [switch]$Once,
  [switch]$NoAutoStart
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Xaml

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$StatePath = Join-Path $Root 'float-panel.state.json'

function Test-PanelServer {
  try {
    Invoke-RestMethod -Uri "$ServerUrl/api/meta" -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Start-PanelServer {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return $false }
  try {
    Start-Process -FilePath $node.Source -ArgumentList 'server.js' -WorkingDirectory $Root -WindowStyle Hidden
  } catch {
    return $false
  }
  for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Milliseconds 300
    if (Test-PanelServer) { return $true }
  }
  return $false
}

# 只拉起、不等待：避免在 UI 线程阻塞导致窗口卡住
function Start-PanelServerQuick {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return $false }
  try {
    Start-Process -FilePath $node.Source -ArgumentList 'server.js' -WorkingDirectory $Root -WindowStyle Hidden
    return $true
  } catch {
    return $false
  }
}

function Write-Log([string]$message) {
  try {
    $logDir = Join-Path $Root 'logs'
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
    Add-Content -Path (Join-Path $logDir 'float-panel.log') -Value ('{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message)
  } catch { }
}

function Get-Snapshot {
  try {
    return Invoke-RestMethod -Uri "$ServerUrl/api/snapshot" -TimeoutSec 4
  } catch {
    return $null
  }
}

function Format-Tokens([double]$value) {
  if ($value -ge 1e9) { return ('{0:0.00}B' -f ($value / 1e9)) }
  if ($value -ge 1e6) { return ('{0:0.00}M' -f ($value / 1e6)) }
  if ($value -ge 1e3) { return ('{0:0.0}K' -f ($value / 1e3)) }
  return ('{0:0}' -f $value)
}

function Format-Money([double]$usd, [string]$currency, [double]$rate) {
  if ($currency -eq 'CNY' -and $rate -gt 0) {
    return ('¥' + ($usd * $rate).ToString('0.###'))
  }
  if ($usd -le 0) { return '$0' }
  if ($usd -lt 0.01) { return ('$' + $usd.ToString('0.00000')) }
  if ($usd -lt 100) { return ('$' + $usd.ToString('0.0000')) }
  return ('$' + $usd.ToString('0.00'))
}

function Read-State {
  if (Test-Path $StatePath) {
    try { return Get-Content -Raw -Path $StatePath | ConvertFrom-Json } catch { }
  }
  return $null
}

function Save-State($state) {
  try { $state | ConvertTo-Json -Depth 4 | Set-Content -Path $StatePath -Encoding UTF8 } catch { }
}

# ---------------------------------------------------------------- 自检模式
if ($Once) {
  if (-not (Test-PanelServer) -and -not $NoAutoStart) { Start-PanelServer | Out-Null }
  $snapshot = Get-Snapshot
  if (-not $snapshot) { Write-Host '未能取到快照（面板服务未运行）'; exit 1 }
  $rate = [double]$snapshot.currency.usdToCny
  $active = $snapshot.sessions | Where-Object { $_.id -eq $snapshot.activeSessionId } | Select-Object -First 1
  $currency = 'CNY'
  if ($active) {
    Write-Host ("本次对话: {0} tokens | {1} | 缓存命中 {2} | 命中率 {3:P1}" -f
      (Format-Tokens $active.totals.total),
      (Format-Money $active.totals.cost $currency $rate),
      (Format-Tokens $active.totals.cached),
      $active.totals.cacheHitRate)
  }
  Write-Host ("今日 {0} | 本月 {1} | 累计 {2}" -f (Format-Money $snapshot.totals.today.cost $currency $rate), (Format-Money $snapshot.totals.month.cost $currency $rate), (Format-Money $snapshot.totals.all.cost $currency $rate))
  Write-Host ("会话数 {0} | 调用 {1} | 快照 {2}" -f $snapshot.sessions.Count, $snapshot.totals.all.calls, $snapshot.generatedAt)
  exit 0
}

# ---------------------------------------------------------------- 启动服务
$serverOnline = Test-PanelServer
if (-not $serverOnline) {
  if (-not $NoAutoStart) { $serverOnline = Start-PanelServer }
}

# ---------------------------------------------------------------- 界面
[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Codex 用量" WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        Topmost="True" ShowInTaskbar="False" SizeToContent="WidthAndHeight"
        ResizeMode="NoResize" WindowStartupLocation="Manual" FontFamily="Microsoft YaHei UI">
  <!-- 外层留出 Margin，阴影才不会被窗口边界裁掉 -->
  <Grid Margin="10">
    <!-- 阴影源单独用一个圆角矩形，避免 Border 的直角边界漏出方形阴影 -->
    <Rectangle x:Name="CardShadow" RadiusX="10" RadiusY="10" Fill="#F2141820">
      <Rectangle.Effect>
        <DropShadowEffect BlurRadius="13" ShadowDepth="1" Direction="270" Opacity="0.5" Color="#000000"/>
      </Rectangle.Effect>
    </Rectangle>

    <Border x:Name="RootCard" CornerRadius="10" Background="#00000000"
            BorderBrush="#3A2F81F7" BorderThickness="1" Padding="11,8,11,9">
      <StackPanel x:Name="RootStack" Width="188">

        <DockPanel>
          <Ellipse x:Name="StatusDot" Width="7" Height="7" Fill="#3FB950" DockPanel.Dock="Left" VerticalAlignment="Center" Margin="0,0,7,0"/>
          <TextBlock x:Name="CloseButton" Text="✕" Tag="noDrag" DockPanel.Dock="Right" Foreground="#8B98A9" FontSize="11"
                     VerticalAlignment="Center" Cursor="Hand" Padding="5,0,0,0" ToolTip="退出悬浮窗"/>
          <TextBlock x:Name="FoldButton" Text="—" Tag="noDrag" DockPanel.Dock="Right" Foreground="#8B98A9" FontSize="11"
                     VerticalAlignment="Center" Cursor="Hand" Padding="5,0,9,0" ToolTip="折叠 / 展开"/>
          <TextBlock Text="Codex 用量" Foreground="#8B98A9" FontSize="11" VerticalAlignment="Center"/>
        </DockPanel>

        <TextBlock x:Name="MiniLine" Text="—" Foreground="#E6EDF3" FontSize="12" Margin="0,5,0,0"
                   FontFamily="Consolas, Microsoft YaHei UI" Visibility="Collapsed"/>

        <StackPanel x:Name="BodyPanel" Margin="0,7,0,0">
          <DockPanel>
            <TextBlock x:Name="SessionTokens" Text="—" DockPanel.Dock="Right" Foreground="#8B98A9" FontSize="12"
                       FontFamily="Consolas" VerticalAlignment="Bottom" Margin="6,0,0,3"/>
            <TextBlock x:Name="SessionCost" Text="—" Foreground="#2F81F7" FontSize="20" FontWeight="Bold"
                       FontFamily="Consolas" VerticalAlignment="Bottom"/>
          </DockPanel>

          <TextBlock x:Name="SessionSub" Text="" Foreground="#8957E5" FontSize="10.5" Margin="0,1,0,0"
                     TextTrimming="CharacterEllipsis"/>

          <Canvas x:Name="Spark" Height="20" Margin="0,7,0,0" ClipToBounds="True"/>

          <TextBlock x:Name="FooterLine" Text="" Foreground="#6E7B8C" FontSize="10.5" Margin="0,6,0,0"
                     TextTrimming="CharacterEllipsis"/>
        </StackPanel>
      </StackPanel>
    </Border>
  </Grid>
</Window>
'@

$reader = New-Object System.Xml.XmlNodeReader $xaml
$window = [System.Windows.Markup.XamlReader]::Load($reader)

$ui = @{}
foreach ($name in 'CardShadow', 'RootCard', 'RootStack', 'StatusDot', 'CloseButton', 'FoldButton', 'MiniLine',
  'BodyPanel', 'SessionTokens', 'SessionCost', 'SessionSub', 'Spark', 'FooterLine') {
  $ui[$name] = $window.FindName($name)
}

# ---------------------------------------------------------------- 状态
$state = Read-State
$appState = [ordered]@{
  currency   = if ($state -and $state.currency) { $state.currency } else { 'CNY' }
  compact    = if ($state -and $null -ne $state.compact) { [bool]$state.compact } else { $false }
  topmost    = if ($state -and $null -ne $state.topmost) { [bool]$state.topmost } else { $true }
  left       = if ($state -and $null -ne $state.left) { [double]$state.left } else { $null }
  top        = if ($state -and $null -ne $state.top) { [double]$state.top } else { $null }
}

$window.Topmost = $appState.topmost

$screen = [System.Windows.SystemParameters]::WorkArea
$useSaved = $false
if ($null -ne $appState.left -and $null -ne $appState.top) {
  # 分辨率或显示器变化后，旧坐标可能落在屏幕外，此时回到默认位置
  if ($appState.left -ge $screen.Left - 40 -and $appState.left -le $screen.Right - 80 -and
    $appState.top -ge $screen.Top - 20 -and $appState.top -le $screen.Bottom - 80) {
    $window.Left = [double]$appState.left
    $window.Top = [double]$appState.top
    $useSaved = $true
  }
}
if (-not $useSaved) {
  $window.Left = $screen.Right - 256
  $window.Top = $screen.Top + 40
}

$script:latest = $null
$script:dragging = $false
$script:offlineTicks = 0

function Apply-Compact {
  if ($appState.compact) {
    $ui.BodyPanel.Visibility = 'Collapsed'
    $ui.MiniLine.Visibility = 'Visible'
  } else {
    $ui.BodyPanel.Visibility = 'Visible'
    $ui.MiniLine.Visibility = 'Collapsed'
  }
}

function Update-Display {
  $snapshot = Get-Snapshot
  $rate = 0.0
  if ($NULL -ne $snapshot) { $rate = [double]$snapshot.currency.usdToCny }

  if ($null -eq $snapshot) {
    $ui.StatusDot.Fill = '#D29922'
    $ui.SessionTokens.Text = '—'
    $ui.SessionCost.Text = '—'
    $ui.SessionSub.Text = '面板服务未运行，正在重试'
    $ui.FooterLine.Text = $ServerUrl
    $ui.MiniLine.Text = '离线'
    $ui.Spark.Children.Clear()
    $ui.RootCard.ToolTip = '未连接到用量服务，悬浮窗会每隔约 30 秒自动重试启动。'
    $script:offlineTicks++
    if (-not $NoAutoStart -and $script:offlineTicks -ge 6 -and ($script:offlineTicks % 15) -eq 6) {
      Start-PanelServerQuick | Out-Null
    }
    return
  }

  $script:offlineTicks = 0
  $script:latest = $snapshot
  $ui.StatusDot.Fill = '#3FB950'

  $active = $null
  foreach ($item in $snapshot.sessions) {
    if ($item.id -eq $snapshot.activeSessionId) { $active = $item; break }
  }

  if ($active) {
    $totals = $active.totals
    $hitRate = [double]$totals.cacheHitRate
    $costText = Format-Money ([double]$totals.cost) $appState.currency $rate
    $tokenText = Format-Tokens ([double]$totals.total)
    $ui.SessionCost.Text = $costText
    $ui.SessionTokens.Text = $tokenText
    $ui.SessionSub.Text = ('缓存 {0} · {1:P1}' -f (Format-Tokens ([double]$totals.cached)), $hitRate)
    $ui.MiniLine.Text = ('{0} · {1}' -f $costText, $tokenText)
    $ui.RootCard.ToolTip = @(
      ('对话：' + $active.project),
      ('调用：{0} 次' -f $active.callCount),
      ('输入 {0} / 输出 {1}' -f (Format-Tokens ([double]$totals.input)), (Format-Tokens ([double]$totals.output))),
      ('未命中输入 {0}' -f (Format-Tokens ([double]($totals.input - $totals.cached)))),
      ('缓存已省 ' + (Format-Money ([double]$totals.dollarSavedByCache) $appState.currency $rate)),
      ('累计花费 ' + (Format-Money ([double]$snapshot.totals.all.cost) $appState.currency $rate))
    ) -join "`n"
  } else {
    $ui.SessionTokens.Text = '—'
    $ui.SessionCost.Text = '—'
    $ui.SessionSub.Text = '暂无进行中的对话'
    $ui.MiniLine.Text = '暂无数据'
    $ui.RootCard.ToolTip = $null
  }

  $tierText = '低谷'
  if ($snapshot.recentCalls.Count -gt 0 -and $snapshot.recentCalls[0].tier -eq 'peak') { $tierText = '高峰' }
  $ui.FooterLine.Text = ('今日 {0} · 本月 {1} · {2}' -f
    (Format-Money ([double]$snapshot.totals.today.cost) $appState.currency $rate),
    (Format-Money ([double]$snapshot.totals.month.cost) $appState.currency $rate),
    $tierText)

  # 迷你柱状图：最近 12 次调用的 token 量
  $ui.Spark.Children.Clear()
  $calls = @($snapshot.recentCalls)
  if ($calls.Count -gt 0) {
    $take = [Math]::Min(12, $calls.Count)
    $series = @()
    for ($i = $take - 1; $i -ge 0; $i--) { $series += [double]$calls[$i].total }
    $max = ($series | Measure-Object -Maximum).Maximum
    if ($max -le 0) { $max = 1 }
    $canvasWidth = 188.0
    $gap = 2.5
    $barWidth = [Math]::Max(4.0, ($canvasWidth - ($take - 1) * $gap) / $take)
    $sparkHeight = 20.0
    for ($i = 0; $i -lt $take; $i++) {
      $value = $series[$i]
      $height = [Math]::Max(2.0, ($value / $max) * $sparkHeight)
      $rect = New-Object System.Windows.Shapes.Rectangle
      $rect.Width = $barWidth
      $rect.Height = $height
      $rect.RadiusX = 2
      $rect.RadiusY = 2
      $brush = New-Object System.Windows.Media.SolidColorBrush
      if ($i -eq $take - 1) {
        $brush.Color = [System.Windows.Media.Color]::FromRgb(0x3F, 0xB9, 0x50)
      } else {
        $brush.Color = [System.Windows.Media.Color]::FromRgb(0x2F, 0x81, 0xF7)
        $brush.Opacity = 0.55
      }
      $rect.Fill = $brush
      [System.Windows.Controls.Canvas]::SetLeft($rect, $i * ($barWidth + $gap))
      [System.Windows.Controls.Canvas]::SetTop($rect, $sparkHeight - $height)
      $ui.Spark.Children.Add($rect) | Out-Null
    }
  }
}

function Open-FullPanel {
  Start-Process $ServerUrl
}

# ---------------------------------------------------------------- 交互
$ui.RootCard.Add_MouseLeftButtonDown({
    param($sender, $event)
    $source = $event.OriginalSource
    if ($source -is [System.Windows.FrameworkElement] -and $source.Tag -eq 'noDrag') { return }
    try { $window.DragMove() } catch { }
  })

$ui.RootCard.Add_MouseLeftButtonUp({
    param($sender, $event)
    $source = $event.OriginalSource
    if ($source -is [System.Windows.FrameworkElement] -and $source.Tag -eq 'noDrag') { return }
    if ($event.ClickCount -ge 2) { Open-FullPanel }
  })

$ui.CloseButton.Add_MouseLeftButtonUp({ $window.Close() })
$ui.FoldButton.Add_MouseLeftButtonUp({
    $appState.compact = -not $appState.compact
    Apply-Compact
  })

$menu = New-Object System.Windows.Controls.ContextMenu
function New-MenuItem([string]$header, $handler) {
  $item = New-Object System.Windows.Controls.MenuItem
  $item.Header = $header
  if ($handler) { $item.Add_Click($handler) }
  return $item
}

$itemOpen = New-MenuItem '打开完整面板' { Open-FullPanel }
$itemCurrency = New-MenuItem '切换货币（USD / CNY）' {
  if ($appState.currency -eq 'USD') { $appState.currency = 'CNY' } else { $appState.currency = 'USD' }
  Update-Display
}
$itemCompact = New-MenuItem '紧凑模式' {
  $appState.compact = -not $appState.compact
  Apply-Compact
}
$itemTop = New-MenuItem '窗口置顶' {
  $appState.topmost = -not $appState.topmost
  $window.Topmost = $appState.topmost
}
$itemRefresh2 = New-MenuItem '刷新间隔：1 秒' { $script:RefreshMs = 1000; $timer.Interval = [TimeSpan]::FromMilliseconds(1000) }
$itemRefresh5 = New-MenuItem '刷新间隔：5 秒' { $script:RefreshMs = 5000; $timer.Interval = [TimeSpan]::FromMilliseconds(5000) }
$itemExit = New-MenuItem '退出' { $window.Close() }

$menu.Items.Add($itemOpen) | Out-Null
$menu.Items.Add((New-Object System.Windows.Controls.Separator)) | Out-Null
$menu.Items.Add($itemCurrency) | Out-Null
$menu.Items.Add($itemCompact) | Out-Null
$menu.Items.Add($itemTop) | Out-Null
$menu.Items.Add($itemRefresh2) | Out-Null
$menu.Items.Add($itemRefresh5) | Out-Null
$menu.Items.Add((New-Object System.Windows.Controls.Separator)) | Out-Null
$menu.Items.Add($itemExit) | Out-Null
$ui.RootCard.ContextMenu = $menu

# ---------------------------------------------------------------- 定时刷新
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds($RefreshMs)
$timer.Add_Tick({
    try {
      Update-Display
    } catch {
      Write-Log ('刷新失败: ' + $_.Exception.Message)
    }
  })

Apply-Compact
try { Update-Display } catch { Write-Log ('首次刷新失败: ' + $_.Exception.Message) }
$timer.Start()

Write-Log ('启动 pid=' + $PID + ' 用户=' + $env:USERNAME + ' 位置=' + [int]$window.Left + ',' + [int]$window.Top + ' 服务=' + $(if ($serverOnline) { '在线' } else { '离线' }))

$window.Add_Closed({
    $timer.Stop()
    $appState.left = $window.Left
    $appState.top = $window.Top
    Save-State $appState
    Write-Log '悬浮窗已关闭'
  })

$null = $window.ShowDialog()
