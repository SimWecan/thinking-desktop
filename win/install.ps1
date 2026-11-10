# Thinking Desktop — Windows 一键安装
# 1) 安装数据服务登录自启（Task Scheduler）
# 2) 编译并启动壁纸+托盘宿主（需要 .NET 8 SDK 与 WebView2 Runtime）
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File win\install.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent   # 项目根（install.ps1 在 win/ 下）
$node = (Get-Command node -ErrorAction SilentlyContinue)?.Source ?? "C:\Program Files\nodejs\node.exe"

Write-Host "1/3 注册数据服务自启（登录时启动 127.0.0.1:7799）…"
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$root\server\index.mjs`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel LeastPrivilege
Register-ScheduledTask -TaskName "ThinkingDesktopServer" -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName "ThinkingDesktopServer"

Write-Host "2/3 编译壁纸宿主…"
dotnet build "$PSScriptRoot\ThinkingDesktopWallpaper\ThinkingDesktopWallpaper.csproj" -c Release

Write-Host "3/3 启动壁纸与托盘…"
Start-Process "$PSScriptRoot\ThinkingDesktopWallpaper\bin\Release\net8.0-windows\ThinkingDesktopWallpaper.exe"
Write-Host "完成。配置页: http://127.0.0.1:7799/config"
