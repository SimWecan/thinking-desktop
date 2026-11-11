#!/bin/bash
# 编译 macOS 桌面壁纸宿主 App
#
# 注意：辅助功能（AX 读屏）授权按二进制指纹记，重编译会让已授权的 App 失效。
# 因此源码/Info.plist 没变时跳过重编译——出包、重启都不会无谓地让用户重新授权。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/Thinking Desktop Wallpaper.app"
BIN="$APP/Contents/MacOS/thinking-desktop-wallpaper"
SRC="$ROOT/macos/main.swift"
PLIST="$ROOT/macos/Info.plist"

mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
if [ -x "$BIN" ] && [ "$BIN" -nt "$SRC" ]; then
  echo "壁纸宿主已是最新（跳过重编译，保留辅助功能授权）: $BIN"
else
  echo "编译 wallpaper 宿主…"
  swiftc -O "$SRC" -o "$BIN"
  echo "完成: ${APP}（二进制已变化，AX 授权需要移除后重新添加）"
fi
# 资源/plist 每次都同步（不改变二进制指纹）
cp "$ROOT/macos/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
cp "$PLIST" "$APP/Contents/Info.plist"
