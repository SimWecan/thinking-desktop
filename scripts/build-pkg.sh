#!/bin/bash
# 生成 macOS 安装包（.pkg，未签名——本机/开发分发用）
# 用法: scripts/build-pkg.sh
# 产物: dist/Thinking-Desktop-<版本>-macos.pkg
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
STAGE="$(mktemp -d /tmp/td-pkg-XXXX)"
PAYLOAD="$STAGE/payload"
SCRIPTS="$STAGE/scripts"
INSTALL_ROOT="Applications/Thinking Desktop"     # pkg 内目标路径（/ 前缀由 pkgbuild 补）
APP="Thinking Desktop Wallpaper.app"
OUT="$ROOT/dist/Thinking-Desktop-$VERSION-macos.pkg"

echo "==> 版本 $VERSION · 重编译壁纸宿主"
"$ROOT/macos/build-wallpaper.sh"
"$ROOT/macos/build-axread.sh" || echo "    axread 编译失败（AX 读屏将不可用，不影响安装）"

echo "==> 组装 payload → /$INSTALL_ROOT"
mkdir -p "$PAYLOAD/$INSTALL_ROOT" "$SCRIPTS"
# 项目本体（排除运行时与仓库元数据）
rsync -a --exclude '.git' --exclude 'dist' --exclude 'logs' --exclude 'data' \
  --exclude '.verify' --exclude "$APP" --exclude '.DS_Store' --exclude 'node_modules' \
  --exclude '._*' --exclude '.Spotlight-V100' --exclude '.fseventsd' \
  "$ROOT/" "$PAYLOAD/$INSTALL_ROOT/"
# 已编译的宿主 App 放项目目录内（install 脚本按相对路径引用）
cp -R "$ROOT/$APP" "$PAYLOAD/$INSTALL_ROOT/$APP"
mkdir -p "$PAYLOAD/$INSTALL_ROOT/logs" "$PAYLOAD/$INSTALL_ROOT/data"
touch "$PAYLOAD/$INSTALL_ROOT/data/.gitkeep" "$PAYLOAD/$INSTALL_ROOT/logs/.gitkeep"

cat > "$SCRIPTS/postinstall" <<'EOS'
#!/bin/bash
# 安装后：把项目属主交给控制台用户，写入 LaunchAgents 并启动服务
set -e
ROOT="/Applications/Thinking Desktop"
LABEL="com.simwecan.thinking-desktop"
WALL_LABEL="com.simwecan.thinking-desktop-wallpaper"
USER_NAME="$(stat -f %Su /dev/console)"
USER_UID="$(id -u "$USER_NAME")"

chown -R "$USER_NAME":staff "$ROOT"

mkdir -p "/Users/$USER_NAME/Library/LaunchAgents"
sed "s|__ROOT__|$ROOT|g" "$ROOT/macos/$LABEL.plist" > "/Users/$USER_NAME/Library/LaunchAgents/$LABEL.plist"
sed "s|__ROOT__|$ROOT|g" "$ROOT/macos/$WALL_LABEL.plist" > "/Users/$USER_NAME/Library/LaunchAgents/$WALL_LABEL.plist"
chown "$USER_NAME":staff "/Users/$USER_NAME/Library/LaunchAgents/"*.plist

launchctl asuser "$USER_UID" launchctl bootout "gui/$USER_UID/$LABEL" 2>/dev/null || true
launchctl asuser "$USER_UID" launchctl bootout "gui/$USER_UID/$WALL_LABEL" 2>/dev/null || true
launchctl asuser "$USER_UID" launchctl bootstrap "gui/$USER_UID" "/Users/$USER_NAME/Library/LaunchAgents/$LABEL.plist"
launchctl asuser "$USER_UID" launchctl bootstrap "gui/$USER_UID" "/Users/$USER_NAME/Library/LaunchAgents/$WALL_LABEL.plist"
launchctl asuser "$USER_UID" launchctl kickstart -k "gui/$USER_UID/$LABEL"
launchctl asuser "$USER_UID" launchctl kickstart -k "gui/$USER_UID/$WALL_LABEL"
echo "Thinking Desktop 已安装并启动：http://127.0.0.1:7799/config"
EOS
chmod +x "$SCRIPTS/postinstall"

mkdir -p "$ROOT/dist"
rm -f "$OUT"
echo "==> pkgbuild → $OUT"
pkgbuild --root "$PAYLOAD" \
  --scripts "$SCRIPTS" \
  --identifier com.simwecan.thinking-desktop \
  --version "$VERSION" \
  --ownership recommended \
  --install-location / \
  "$OUT"
rm -rf "$STAGE"
ls -lh "$OUT"
echo "完成。安装: 双击 pkg（未签名，或 sudo installer -pkg \"$OUT\" -target /）"
