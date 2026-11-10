#!/bin/bash
# 编译 AX 读屏小工具（给不落盘日志的闭源桌面端补文本）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/bin"
echo "编译 axread…"
swiftc -O "$ROOT/macos/axread.swift" -o "$ROOT/bin/axread"
echo "完成: $ROOT/bin/axread"
