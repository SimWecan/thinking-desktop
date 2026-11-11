#!/bin/bash
# 生成 Windows 源码安装包（zip）：项目运行所需子集 + install.ps1 + Inno 脚本
# 用法: scripts/build-win.sh
# 产物: dist/Thinking-Desktop-<版本>-win.zip
# 真机安装: 解压 → powershell -NoProfile -ExecutionPolicy Bypass -File win\install.ps1
# Setup.exe: 把 zip 内容放进 dist-src/ 后在 Windows 上 iscc win\installer.iss
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
STAGE="$(mktemp -d /tmp/td-win-XXXX)"
OUT="$ROOT/dist/Thinking-Desktop-$VERSION-win.zip"

echo "==> 版本 $VERSION · 组装 Windows 源码包"
for d in server web config win docs scripts test connectors bin; do
  [ -d "$ROOT/$d" ] && rsync -a --exclude '.DS_Store' "$ROOT/$d" "$STAGE/"
done
for f in package.json README.md RELEASE.md LICENSE; do
  [ -f "$ROOT/$f" ] && cp "$ROOT/$f" "$STAGE/"
done
rm -f "$STAGE/scripts/build-pkg.sh"   # macOS 专用

mkdir -p "$ROOT/dist"
rm -f "$OUT"
# COPYFILE_DISABLE 去掉 __MACOSX 资源叉垃圾
( COPYFILE_DISABLE=1; export COPYFILE_DISABLE; cd "$STAGE" && zip -q -r "$OUT" . )
rm -rf "$STAGE"
ls -lh "$OUT"
echo "完成。Windows 上解压后运行: powershell -NoProfile -ExecutionPolicy Bypass -File win\\install.ps1"
