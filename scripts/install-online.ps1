# Thinking Desktop — Windows 在线安装（用户级，无需管理员）
#
# 给「一句话安装」用：下载源码包 → 装到 %LOCALAPPDATA%\Thinking Desktop → 注册登录自启
# → 编译并启动壁纸宿主 → 自动绑定本机 AI 客户端 → 打开控制台。
#
# 用法（PowerShell）：
#   irm <下载页>/install-online.ps1 | iex
#   # 或本地：
#   powershell -NoProfile -ExecutionPolicy Bypass -File install-online.ps1
#
# 可选环境变量：TD_RELEASE_BASE / TD_INSTALL_DIR / TD_NO_OPEN=1 / TD_SKIP_PREREQ=1

$ErrorActionPreference = "Stop"
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$Base = if ($env:TD_RELEASE_BASE) { $env:TD_RELEASE_BASE } else { "https://github.com/SimWecan/thinking-desktop/releases/latest/download" }
$Service = "http://127.0.0.1:7799"
$InstallDir = if ($env:TD_INSTALL_DIR) { $env:TD_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "Thinking Desktop" }
$OpenConsole = ($env:TD_NO_OPEN -ne "1")
$SkipPrereq = ($env:TD_SKIP_PREREQ -eq "1")
$Tmp = Join-Path $env:TEMP ("td-install-" + [guid]::NewGuid().ToString("N"))

function Say($m)  { Write-Host $m }
function Step($m) { Write-Host $m -ForegroundColor Cyan }
function Warn($m) { Write-Host $m -ForegroundColor Yellow }
function Die($m)  { Write-Host ("错误：" + $m) -ForegroundColor Red; exit 1 }

function ServiceUp {
  try { $r = Invoke-WebRequest -Uri "$Service/health" -UseBasicParsing -TimeoutSec 2; return ($r.StatusCode -eq 200) } catch { return $false }
}
function RefreshPath {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

New-Item -ItemType Directory -Path $Tmp -Force | Out-Null
try {
  # ---------- 1. 已在运行：直接配置 ----------
  $already = ServiceUp
  if ($already) {
    Say "检测到 Thinking Desktop 服务已在运行，跳过下载与安装，直接进入配置。"
  } else {
    # ---------- 2. 前置：Node.js 20+ / .NET 8 SDK ----------
    Step "1/5 检查 Node.js 与 .NET SDK…"
    $node = Get-Command node -ErrorAction SilentlyContinue
    $nodeOk = $false
    if ($node) {
      $v = (& $node.Source -v).Trim()
      $major = 0; [void][int]::TryParse(($v.TrimStart("v").Split(".")[0]), [ref]$major)
      $nodeOk = ($major -ge 20)
    }
    if (-not $nodeOk) {
      if ($SkipPrereq) { Die "需要 Node.js 20+：https://nodejs.org/" }
      Warn "未找到 Node.js 20+，尝试用 winget 安装 Node.js LTS（Ctrl-C 可取消）…"
      if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Die "没有 winget；请先安装 Node.js 20+：https://nodejs.org/" }
      winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
      RefreshPath
      $node = Get-Command node -ErrorAction SilentlyContinue
      if (-not $node) { Die "Node.js 安装后仍找不到 node，请重开一个终端再运行本脚本" }
    }
    Say ("    node " + (& $node.Source -v))

    $dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
    $sdkOk = $false
    if ($dotnet) {
      $sdks = & $dotnet.Source --list-sdks 2>$null
      $sdkOk = ($sdks | Select-String -Pattern "^8\." -Quiet)
    }
    if (-not $sdkOk) {
      if ($SkipPrereq) { Die "壁纸宿主需要 .NET 8 SDK：https://dotnet.microsoft.com/download" }
      Warn "未找到 .NET 8 SDK，尝试用 winget 安装（壁纸宿主编译需要）…"
      if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Die "没有 winget；请先安装 .NET 8 SDK：https://dotnet.microsoft.com/download" }
      winget install --id Microsoft.DotNet.SDK.8 -e --silent --accept-package-agreements --accept-source-agreements
      RefreshPath
    }

    # ---------- 3. 下载 + 校验 + 解压 ----------
    Step "2/5 下载安装包…"
    $zip = Join-Path $Tmp "td.zip"
    $url = "$Base/Thinking-Desktop-win.zip"
    Say ("    " + $url)
    try { Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 120 }
    catch { Die "下载失败。若下载页不是 GitHub Release，请设置 TD_RELEASE_BASE 指向实际下载目录" }

    $shaText = ""
    try { $shaText = (Invoke-WebRequest -Uri "$Base/Thinking-Desktop-win.zip.sha256" -UseBasicParsing -TimeoutSec 10).Content.Trim() } catch { $shaText = "" }
    if ($shaText) {
      $expect = ($shaText -split "\s+")[0].ToLower()
      $actual = (Get-FileHash -Path $zip -Algorithm SHA256).Hash.ToLower()
      if ($actual -ne $expect) { Die "安装包校验失败（sha256 不匹配），已中止" }
      Say "    sha256 校验通过"
    } else {
      Warn "    未找到 .sha256，跳过校验"
    }

    Step "3/5 安装到 $InstallDir…"
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    # 升级时保留用户配置与数据：先备份，解压后覆盖回去
    $hasCfg = Test-Path (Join-Path $InstallDir "config")
    $hasData = Test-Path (Join-Path $InstallDir "data")
    if ($hasCfg)  { Copy-Item (Join-Path $InstallDir "config") (Join-Path $Tmp "config") -Recurse -Force }
    if ($hasData) { Copy-Item (Join-Path $InstallDir "data")  (Join-Path $Tmp "data")  -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $InstallDir -Force
    if ($hasCfg)  { Remove-Item (Join-Path $InstallDir "config") -Recurse -Force -ErrorAction SilentlyContinue
                    Copy-Item (Join-Path $Tmp "config") (Join-Path $InstallDir "config") -Recurse -Force }
    if ($hasData) { Remove-Item (Join-Path $InstallDir "data") -Recurse -Force -ErrorAction SilentlyContinue
                    Copy-Item (Join-Path $Tmp "data") (Join-Path $InstallDir "data") -Recurse -Force }
    @("logs", "data", "config") | ForEach-Object { New-Item -ItemType Directory -Path (Join-Path $InstallDir $_) -Force | Out-Null }
    if (-not (Test-Path (Join-Path $InstallDir "server\index.mjs"))) { Die "安装包结构异常：缺少 server\index.mjs" }

    # ---------- 4. 注册自启 + 编译启动壁纸 ----------
    Step "4/5 注册登录自启并编译壁纸宿主…"
    $installer = Join-Path $InstallDir "win\install.ps1"
    if (-not (Test-Path $installer)) { Die "安装包缺少 win\install.ps1" }
    & powershell -NoProfile -ExecutionPolicy Bypass -File $installer
    if ($LASTEXITCODE -ne 0) { Die "win\install.ps1 执行失败（退出码 $LASTEXITCODE）" }

    # ---------- 5. 等服务就绪 ----------
    Step "5/5 等待服务就绪…"
    $ok = $false
    for ($i = 0; $i -lt 40; $i++) {
      if (ServiceUp) { $ok = $true; break }
      Start-Sleep -Milliseconds 500
    }
    if (-not $ok) { Die ("服务启动超时。查看日志：" + (Join-Path $InstallDir "logs\server.err.log")) }
    Say ("    服务已就绪：" + $Service)
  }

  # ---------- 6. 检索本机 AI 客户端 → 一键绑定 ----------
  Step "检索本机 AI 客户端…"
  $sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  Invoke-WebRequest -Uri "$Service/console" -WebSession $sess -UseBasicParsing | Out-Null
  $agents = Invoke-RestMethod -Uri "$Service/agents" -WebSession $sess
  $detected = @()
  foreach ($a in $agents.agents) {
    if (-not $a.installed) { continue }
    $detected += $a
    try {
      $body = @{ source = $a.source; enabled = $true } | ConvertTo-Json -Compress
      Invoke-RestMethod -Uri "$Service/agents" -Method Post -Body $body -ContentType "application/json" -WebSession $sess | Out-Null
    } catch { Warn ("    绑定 " + $a.name + " 失败：" + $_.Exception.Message) }
    $tag = if ($a.connected) { "已接线" } else { "已安装（暂无检测通道）" }
    Write-Host ("  ● " + $a.name.PadRight(18) + " " + $tag)
  }
  if ($detected.Count -eq 0) {
    Warn "  未检索到已安装的 AI 桌面端。装好 DSH / Kimi / Gemini / ChatGPT / Claude 后重新运行本脚本。"
  }
  try {
    Invoke-RestMethod -Uri "$Service/view" -Method Post -Body '{"agent":"all"}' -ContentType "application/json" -WebSession $sess | Out-Null
  } catch {}

  # ---------- 7. 打开控制台 ----------
  if ($OpenConsole) { Start-Process "$Service/console" | Out-Null }

  Write-Host ""
  Write-Host "Thinking Desktop 已安装并启动" -ForegroundColor White
  Write-Host ("  安装目录   " + $InstallDir)
  Write-Host ("  服务       " + $Service)
  Write-Host ("  控制台     " + $Service + "/console")
  Write-Host ("  已绑定     " + $detected.Count + " 个 AI 桌面端")
  Write-Host ""
  Write-Host "提示：Windows 宿主需要 WebView2 Runtime（Win11 自带）；若壁纸没出现，装一下 WebView2。"
}
finally {
  Remove-Item -Path $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}
