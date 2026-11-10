#!/bin/bash
# macOS 一键安装：launchd 自启数据服务 + 壁纸宿主（登录自启 + 崩溃自愈）
# 用法: macos/install.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.simwecan.thinking-desktop"
WALL_LABEL="com.simwecan.thinking-desktop-wallpaper"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"
WALL_PLIST_DST="$HOME/Library/LaunchAgents/$WALL_LABEL.plist"

mkdir -p "$ROOT/logs"

echo "1/4 安装 launchd 服务 ($LABEL)…"
sed "s|__ROOT__|$ROOT|g" "$ROOT/macos/$LABEL.plist" > "$PLIST_DST"
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST_DST"
launchctl kickstart -k "gui/$UID/$LABEL"

echo "2/4 编译壁纸宿主 App…"
"$ROOT/macos/build-wallpaper.sh"
echo "    编译 AX 读屏小工具（可选，用于给 Gemini/ChatGPT 补文本）…"
"$ROOT/macos/build-axread.sh" || echo "    axread 编译失败，AX 读屏将不可用（不影响其它功能）"

echo "3/4 安装壁纸自启 ($WALL_LABEL)…"
# 直接守护 .app 内的可执行文件本体：崩溃 10s 后自动拉起，登录自动启动；
# App 内有单实例守卫，手动 open 不会叠出第二层壁纸
sed "s|__ROOT__|$ROOT|g" "$ROOT/macos/$WALL_LABEL.plist" > "$WALL_PLIST_DST"
launchctl bootout "gui/$UID/$WALL_LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$WALL_PLIST_DST"
launchctl kickstart "gui/$UID/$WALL_LABEL"

echo "4/4 启动壁纸…"
open "$ROOT/Thinking Desktop Wallpaper.app" 2>/dev/null || true   # 已运行则由单实例守卫跳过

echo "完成。服务状态: launchctl print gui/$UID/$LABEL | grep state"
echo "     壁纸状态: launchctl print gui/$UID/$WALL_LABEL | grep state"
