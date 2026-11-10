#!/bin/bash
# 编译 macOS 桌面壁纸宿主 App
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/Thinking Desktop Wallpaper.app"

mkdir -p "$APP/Contents/MacOS"
echo "编译 wallpaper 宿主…"
swiftc -O "$ROOT/macos/main.swift" -o "$APP/Contents/MacOS/thinking-desktop-wallpaper"
cp "$ROOT/macos/Info.plist" "$APP/Contents/Info.plist"
echo "完成: $APP"
