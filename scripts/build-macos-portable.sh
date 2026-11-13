#!/bin/bash
# 生成 macOS 便携包（tar.gz，用户级安装用，无需 sudo）
#
# 产物：
#   dist/Thinking-Desktop-<版本>-macos.tar.gz      版本化归档
#   dist/Thinking-Desktop-macos.tar.gz             固定名（install-online.sh 默认拉这个）
#   dist/Thinking-Desktop-macos.tar.gz.sha256      校验文件
#
# 「一句话安装」流程见 scripts/install-online.sh；pkg 仍保留给管理员安装。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
STAGE="$(mktemp -d /tmp/td-portable-XXXX)"
OUT_VER="$ROOT/dist/Thinking-Desktop-$VERSION-macos.tar.gz"
OUT_FIXED="$ROOT/dist/Thinking-Desktop-macos.tar.gz"

echo "==> 版本 $VERSION · 编译宿主 App"
bash "$ROOT/macos/build-wallpaper.sh"
bash "$ROOT/macos/build-console.sh"
bash "$ROOT/macos/build-axread.sh" || echo "    axread 编译失败（AX 读屏不可用，不影响安装）"

echo "==> 组装便携包"
DEST="$STAGE/Thinking Desktop"
mkdir -p "$DEST"
# 运行时需要的全部内容；config/data/logs 由安装器创建（避免把开发者本机配置带给用户）
rsync -a \
  --exclude '.git' --exclude 'dist' --exclude '.verify' --exclude 'logs' --exclude 'data' \
  --exclude 'config' --exclude 'node_modules' --exclude '.DS_Store' --exclude '._*' \
  --exclude 'Thinking Desktop.app' --exclude 'Thinking Desktop Wallpaper.app' \
  --exclude 'Promotional video' --exclude 'promotional video' \
  "$ROOT/" "$DEST/"
cp -R "$ROOT/Thinking Desktop.app" "$DEST/Thinking Desktop.app"
cp -R "$ROOT/Thinking Desktop Wallpaper.app" "$DEST/Thinking Desktop Wallpaper.app"
mkdir -p "$DEST/config"
cp "$ROOT/config/ui.example.json" "$DEST/config/ui.example.json" 2>/dev/null || true
mkdir -p "$DEST/logs" "$DEST/data" "$DEST/config"
touch "$DEST/logs/.gitkeep" "$DEST/data/.gitkeep"

mkdir -p "$ROOT/dist"
rm -f "$OUT_VER" "$OUT_FIXED" "$OUT_FIXED.sha256"
echo "==> 打包 → $OUT_VER"
( cd "$STAGE" && COPYFILE_DISABLE=1 tar --no-xattrs -czf "$OUT_VER" "Thinking Desktop" )
cp "$OUT_VER" "$OUT_FIXED"
( cd "$ROOT/dist" && shasum -a 256 "$(basename "$OUT_FIXED")" > "$(basename "$OUT_FIXED").sha256" )

rm -rf "$STAGE"
ls -lh "$OUT_VER" "$OUT_FIXED" "$OUT_FIXED.sha256"
echo "完成。上传 dist/ 下这三个文件到下载页目录（或 GitHub Release）。"
