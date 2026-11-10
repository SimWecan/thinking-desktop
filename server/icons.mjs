/**
 * 厂商图标：直接从本机安装的 .app 里取官方图标（ICNS），转成 PNG 缓存到 data/icons/。
 *
 * 为什么这样做：
 * - 用软件自己的商标图，而不是手绘近似图形；
 * - 图标只在本机从已安装的 App 提取、落在 gitignore 的 data/ 下，不随仓库分发；
 * - 换机器/升级 App 后，源文件 mtime 变了会重新提取。
 */

import { existsSync, statSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { join } from "node:path";

/** 各来源对应的 App 与候选图标文件（按优先级） */
const CANDIDATES = {
  "deepseek-harness": [
    "/Applications/DeepSeek Harness.app/Contents/Resources/icon.icns",
    "/Applications/DeepSeek Harness.app/Contents/Resources/Icon.icns",
  ],
  "kimi-desktop": [
    "/Applications/Kimi.app/Contents/Resources/icon.icns",
    "/Applications/Kimi.app/Contents/Resources/Icon.icns",
  ],
  "gemini-desktop": [
    "/Applications/Gemini.app/Contents/Resources/AppIcon.icns",
    "/Applications/Gemini.app/Contents/Resources/icon.icns",
  ],
  "chatgpt-desktop": [
    "/Applications/ChatGPT.app/Contents/Resources/icon-chatgpt.icns",
    "/Applications/ChatGPT.app/Contents/Resources/app.icns",
  ],
  "claude-desktop": [
    "/Applications/Claude.app/Contents/Resources/icon.icns",
    "/Applications/Claude.app/Contents/Resources/AppIcon.icns",
  ],
  // Codex 只有 CLI，没有 .app；留给 fallback（字母牌）
  codex: [],
};

function appDirs(source) {
  return (CANDIDATES[source] || []).map((p) => p);
}

/** 找 .app 里第一个像应用图标的 .icns（排除 electron 通用图标） */
function looseIcon(appPath) {
  const dir = join(appPath, "Contents", "Resources");
  try {
    const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".icns"));
    const preferred = files.find((f) => !/electron/i.test(f)) || files[0];
    return preferred ? join(dir, preferred) : null;
  } catch {
    return null;
  }
}

/**
 * 手动指定图标：config/icons.json = { "codex": "/path/to/codex.png", ... }
 * 用于没有 .app 可提取的厂商（比如只有 CLI 的 Codex）。
 */
function readOverrides(root) {
  try { return JSON.parse(readFileSync(join(root, "config", "icons.json"), "utf8")); } catch { return {}; }
}

export function resolveIconSource(source, root) {
  if (root) {
    const p = readOverrides(root)[source];
    if (p && existsSync(p)) return p;
  }
  return resolveFromApp(source);
}

function resolveFromApp(source) {
  for (const p of appDirs(source)) if (existsSync(p)) return p;
  const app = (CANDIDATES[source] || [])[0]?.split("/Contents/")[0];
  if (app && existsSync(app)) return looseIcon(app);
  return null;
}

const cacheDir = (root) => join(root, "data", "icons");

export function cachedIconPath(root, source) {
  return join(cacheDir(root), `${source}.png`);
}

/** 用 sips 把 ICNS 转成指定边长的 PNG */
function convert(icns, out, size, cb) {
  execFile("/usr/bin/sips", ["-Z", String(size), "-s", "format", "png", icns, "--out", out], (err) => cb(err));
}

/**
 * 提取所有可用的厂商图标（幂等：缓存比源文件新就跳过）。
 * @param {string} root 项目根目录
 * @param {(msg: string) => void} [log]
 */
export function buildIcons(root, log = () => {}) {
  const dir = cacheDir(root);
  try { mkdirSync(dir, { recursive: true }); } catch { /* 忽略 */ }

  for (const source of Object.keys(CANDIDATES)) {
    const src = resolveIconSource(source, root);
    if (!src) continue;
    const out = cachedIconPath(root, source);
    try {
      if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) continue;
    } catch { /* 落到重新提取 */ }
    convert(src, out, 256, (err) => {
      if (err) log(`[icons] ${source} 提取失败: ${err.message}`);
      else log(`[icons] ${source} ← ${src}`);
    });
  }
}

/** 生成的 2x（512）版本，托盘在 Retina 上更清晰 */
export function ensureIcon2x(root, source, cb) {
  const src = resolveIconSource(source, root);
  if (!src) return cb(null, null);
  const out = join(cacheDir(root), `${source}@2x.png`);
  try {
    if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) return cb(null, out);
  } catch { /* 继续生成 */ }
  try { mkdirSync(cacheDir(root), { recursive: true }); } catch { /* 忽略 */ }
  convert(src, out, 512, (err) => cb(err, err ? null : out));
}

