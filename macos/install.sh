#!/bin/bash
# macOS 一键安装：launchd 自启数据服务 + 编译并启动桌面壁纸宿主
# 用法: macos/install.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.simwecan.thinking-desktop"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"

mkdir -p "$ROOT/logs"

echo "1/3 安装 launchd 服务 ($LABEL)…"
sed "s|__ROOT__|$ROOT|g" "$ROOT/macos/$LABEL.plist" > "$PLIST_DST"
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST_DST"
launchctl kickstart -k "gui/$UID/$LABEL"

echo "2/3 编译壁纸宿主 App…"
"$ROOT/macos/build-wallpaper.sh"

echo "3/3 启动壁纸…"
open "$ROOT/Thinking Desktop Wallpaper.app"

echo "完成。服务状态: launchctl print gui/$UID/$LABEL | grep state"
