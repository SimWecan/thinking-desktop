#!/bin/bash
# Thinking Desktop — macOS 在线安装（用户级，无需 sudo）
#
# 给「一句话安装」用：下载预编译包 → 装到 ~/Applications → 启动服务 → 自动绑定本机 AI 客户端 → 打开控制台。
#
# 用法：
#   curl -fsSL <下载页>/install-online.sh | bash
#   bash install-online.sh --file ./Thinking-Desktop-macos.tar.gz     # 本地包（离线/自测）
#   bash install-online.sh --base https://example.com/td             # 自托管下载目录
#   bash install-online.sh --configure-only                          # 只做「检索 + 绑定 + 打开控制台」
#   bash install-online.sh --force                                   # 服务在跑也强制升级
#
# 可选环境变量：TD_RELEASE_BASE / TD_INSTALL_DIR
set -euo pipefail

BASE="${TD_RELEASE_BASE:-https://github.com/SimWecan/thinking-desktop/releases/latest/download}"
INSTALL_DIR="${TD_INSTALL_DIR:-$HOME/Applications/Thinking Desktop}"
ARTIFACT=""
OPEN_APP=1
DO_START=1
CONFIGURE_ONLY=0
ENABLE_CLIENTS=1
FORCE=0
TMP=""
SERVICE="http://127.0.0.1:7799"

say()  { printf "\033[1m%s\033[0m\n" "$*"; }
step() { printf "\033[36m%s\033[0m\n" "$*"; }
warn() { printf "\033[33m%s\033[0m\n" "$*" >&2; }
die()  { printf "\033[31m错误：%s\033[0m\n" "$*" >&2; exit 1; }
cleanup() { [ -n "$TMP" ] && rm -rf "$TMP"; }
trap cleanup EXIT

while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="${2:?}"; shift 2 ;;
    --file) ARTIFACT="${2:?}"; shift 2 ;;
    --dir) INSTALL_DIR="${2:?}"; shift 2 ;;
    --no-open) OPEN_APP=0; shift ;;
    --no-start) DO_START=0; shift ;;        # 自测/CI：只下载解压，不碰 launchd
    --configure-only) CONFIGURE_ONLY=1; shift ;;
    --no-enable) ENABLE_CLIENTS=0; shift ;;
    --force) FORCE=1; shift ;;               # 服务在跑也强制重新下载/解压（升级）
    -y|--yes) shift ;;                       # 兼容提示语，无需确认
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) die "未知参数：$1" ;;
  esac
done

[ "$(uname -s)" = "Darwin" ] || die "这个脚本只用于 macOS；Windows 请用 install-online.ps1"

service_up() { curl -fsS -m 2 "$SERVICE/health" >/dev/null 2>&1; }

# ---------- 1. 服务已在运行：跳过安装，直接进入配置 ----------
if [ "$CONFIGURE_ONLY" = 0 ] && [ "$FORCE" = 0 ] && service_up; then
  say "检测到 Thinking Desktop 服务已在运行，跳过下载与安装，直接进入配置。"
  CONFIGURE_ONLY=2   # 2 = 服务原本就在
fi

if [ "$CONFIGURE_ONLY" = 0 ]; then
  # ---------- 2. Node.js 20+（服务端只依赖 Node 标准库） ----------
  step "1/5 检查 Node.js…"
  NODE_BIN="$(command -v node || true)"
  need_node=1
  if [ -n "$NODE_BIN" ] && "$NODE_BIN" -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)' 2>/dev/null; then
    need_node=0
    say "    node $("$NODE_BIN" -v) → $NODE_BIN"
  fi
  if [ "$need_node" = 1 ]; then
    if command -v brew >/dev/null 2>&1; then
      warn "未找到 Node.js 20+，尝试用 Homebrew 安装（这会改动系统环境，Ctrl-C 可取消）…"
      brew install node || die "Homebrew 安装 Node 失败，请手动安装：https://nodejs.org/"
      hash -r 2>/dev/null || true
      NODE_BIN="$(command -v node || true)"
    else
      die "需要 Node.js 20+：请先安装（https://nodejs.org/ 或 brew install node），再重新运行本脚本"
    fi
  fi
  [ -n "$NODE_BIN" ] || die "找不到 node"

  # ---------- 3. 下载 + 校验 + 解压 ----------
  step "2/5 下载安装包…"
  TMP="$(mktemp -d /tmp/td-install-XXXXXX)"
  # 文件名必须和 .sha256 里记录的一致（shasum -c 按文件名查找）
  TGZ="$TMP/Thinking-Desktop-macos.tar.gz"
  if [ -n "$ARTIFACT" ]; then
    [ -f "$ARTIFACT" ] || die "找不到本地安装包：$ARTIFACT"
    cp "$ARTIFACT" "$TGZ"
    say "    使用本地包：$ARTIFACT"
  else
    URL="$BASE/Thinking-Desktop-macos.tar.gz"
    say "    $URL"
    curl -fL --retry 3 --connect-timeout 15 -o "$TGZ" "$URL" \
      || die "下载失败。若下载页不是 GitHub Release，请用 --base 指定实际目录，或用 --file 指定本地包"
    if curl -fsSL --connect-timeout 10 -o "$TMP/td.sha256" "$BASE/Thinking-Desktop-macos.tar.gz.sha256" 2>/dev/null; then
      ( cd "$TMP" && shasum -a 256 -c td.sha256 >/dev/null 2>&1 ) || die "安装包校验失败（sha256 不匹配），已中止"
      say "    sha256 校验通过"
    else
      warn "    未找到 .sha256，跳过校验"
    fi
  fi

  step "3/5 安装到 ${INSTALL_DIR}…"
  mkdir -p "$INSTALL_DIR"
  tar -xzf "$TGZ" -C "$INSTALL_DIR" --strip-components=1
  mkdir -p "$INSTALL_DIR/logs" "$INSTALL_DIR/data" "$INSTALL_DIR/config"
  [ -f "$INSTALL_DIR/server/index.mjs" ] || die "安装包结构异常：缺少 server/index.mjs"
  say "    已解压 $(du -sh "$INSTALL_DIR" | cut -f1)"

  # ---------- 4. 登录自启（两个 LaunchAgent，用户级） ----------
  if [ "$DO_START" = 1 ]; then
    step "4/5 注册登录自启并启动…"
    UID_="$(id -u)"
    LA="$HOME/Library/LaunchAgents"
    mkdir -p "$LA"
    for L in com.simwecan.thinking-desktop com.simwecan.thinking-desktop-wallpaper; do
      SRC="$INSTALL_DIR/macos/$L.plist"
      [ -f "$SRC" ] || die "安装包缺少 $L.plist"
      sed -e "s|__ROOT__|$INSTALL_DIR|g" -e "s|/opt/homebrew/bin/node|$NODE_BIN|g" "$SRC" > "$LA/$L.plist"
      chmod 644 "$LA/$L.plist"
      launchctl bootout "gui/$UID_/$L" >/dev/null 2>&1 || true
      launchctl bootstrap "gui/$UID_" "$LA/$L.plist"
    done
    launchctl kickstart -k "gui/$UID_/com.simwecan.thinking-desktop"
    launchctl kickstart -k "gui/$UID_/com.simwecan.thinking-desktop-wallpaper"
  else
    say "4/5 已跳过启动（--no-start）"
  fi

  # ---------- 5. 等服务就绪 ----------
  if [ "$DO_START" = 1 ]; then
    step "5/5 等待服务就绪…"
    ok=0
    for _ in $(seq 1 40); do
      if service_up; then ok=1; break; fi
      sleep 0.5
    done
    [ "$ok" = 1 ] || die "服务启动超时。查看日志：$INSTALL_DIR/logs/server.err.log"
    say "    服务已就绪：$SERVICE"
  else
    say "5/5 已跳过服务检查（--no-start）"
    say "安装完成（未启动）：$INSTALL_DIR"
    exit 0
  fi
fi

# ---------- 6. 检索本机 AI 客户端 → 一键绑定 ----------
if [ -z "${NODE_BIN:-}" ]; then
  NODE_BIN="$(command -v node || true)"
  [ -n "$NODE_BIN" ] || die "--configure-only 需要 Node.js 20+ 才能解析 /agents；也可以在控制台里手动绑定"
fi
service_up || die "服务未运行（${SERVICE}）。请先正常安装，或检查壁纸/服务是否被退出"
# 服务在跑但不知道装在哪：按两个已知位置反推（用户级 / 系统级），只用于展示
if [ ! -f "$INSTALL_DIR/server/index.mjs" ]; then
  for d in "/Applications/Thinking Desktop" "$HOME/Applications/Thinking Desktop"; do
    [ -f "$d/server/index.mjs" ] && INSTALL_DIR="$d" && break
  done
fi
step "检索本机 AI 客户端…"
TMP="${TMP:-$(mktemp -d /tmp/td-install-XXXXXX)}"
CJ="$TMP/cookies"
curl -fsS -c "$CJ" -o /dev/null "$SERVICE/console" || die "服务可达但控制台打不开：$SERVICE/console"
curl -fsS -b "$CJ" "$SERVICE/agents" -o "$TMP/agents.json" || die "读取 /agents 失败"

# 用 node 解析（服务端本来就依赖 Node），避免要求 jq/python
"$NODE_BIN" -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const rows = (data.agents || []).filter((a) => a.installed);
for (const a of rows) console.log(a.source + "\t" + a.name + "\t" + (a.connected ? "channel" : "no-channel"));
' "$TMP/agents.json" > "$TMP/detected.tsv" || die "解析 /agents 失败"

DETECTED=0
while IFS=$'\t' read -r src name kind; do
  [ -n "$src" ] || continue
  DETECTED=$((DETECTED + 1))
  if [ "$ENABLE_CLIENTS" = 1 ]; then
    curl -fsS -b "$CJ" -H "Content-Type: application/json" \
      --data "{\"source\":\"$src\",\"enabled\":true}" "$SERVICE/agents" >/dev/null 2>&1 || true
  fi
  if [ "$kind" = "channel" ]; then
    printf "  \033[32m●\033[0m %-18s %s\n" "$name" "已接线"
  else
    printf "  \033[33m●\033[0m %-18s %s\n" "$name" "已安装（暂无检测通道）"
  fi
done < "$TMP/detected.tsv"

if [ "$DETECTED" = 0 ]; then
  warn "  未检索到已安装的 AI 桌面端。装好 DSH / Kimi / Gemini / ChatGPT / Claude 后，运行："
  warn "  bash \"$INSTALL_DIR/scripts/install-online.sh\" --configure-only"
fi

# 综合形态：所有来源一起上墙
curl -fsS -b "$CJ" -H "Content-Type: application/json" --data '{"agent":"all"}' "$SERVICE/view" >/dev/null 2>&1 || true

# ---------- 7. 打开控制台 ----------
if [ "$OPEN_APP" = 1 ] && [ -d "$INSTALL_DIR/Thinking Desktop.app" ]; then
  open "$INSTALL_DIR/Thinking Desktop.app" >/dev/null 2>&1 || true
fi

if [ "$CONFIGURE_ONLY" = 0 ]; then
  TITLE="Thinking Desktop 已安装并启动"
else
  TITLE="Thinking Desktop 已配置（服务原本就在运行）"
fi
cat <<EOF

$(printf "\033[1m%s\033[0m" "$TITLE")
  安装目录   $INSTALL_DIR
  服务       $SERVICE
  控制台     $SERVICE/console
  壁纸       $SERVICE/wall
  已绑定     $DETECTED 个 AI 桌面端（可在控制台继续增删 / 调色）

下一步：
  · 首次使用壁纸时，在 系统设置 → 隐私与安全性 → 辅助功能 里授权
    「Thinking Desktop Wallpaper」，Gemini / ChatGPT 才能读到真实文本。
  · 移动/删除了 AI 客户端后，重新运行本脚本的 --configure-only 即可重新检索绑定。
EOF
