#!/bin/bash
# 编译 macOS 控制台 App（双击启动：运行状态 / 实时日志 / 重启操作）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/Thinking Desktop.app"

mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
echo "编译 console 宿主…"
swiftc -O "$ROOT/macos/console/main.swift" -o "$APP/Contents/MacOS/thinking-desktop-console"
cp "$ROOT/macos/console/Info.plist" "$APP/Contents/Info.plist"
cp "$ROOT/web/icon/thinking-desktop-512.png" "$APP/Contents/Resources/thinking-desktop.png"
echo "完成: $APP"
