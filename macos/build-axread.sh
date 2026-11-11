#!/bin/bash
# 编译 AX 读屏小工具（给不落盘日志的闭源桌面端补文本）
#
# 注意：辅助功能授权是按「二进制指纹（cdhash）」记的——只要 axread 被重新编译，
# 之前授过的权就失效了。所以这里默认只在源码比二进制新时才重编译，
# 避免每次出包都把用户的授权弄丢（真的改过源码后需要重新授权一次）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/macos/axread.swift"
OUT="$ROOT/bin/axread"
mkdir -p "$ROOT/bin"

if [ -x "$OUT" ] && [ "$OUT" -nt "$SRC" ]; then
  echo "axread 已是最新（未重编译，保留辅助功能授权）: $OUT"
  exit 0
fi

echo "编译 axread…"
swiftc -O "$SRC" -o "$OUT"
echo "完成: $OUT（二进制已变化，需在 系统设置 → 隐私与安全性 → 辅助功能 中移除后重新添加）"
