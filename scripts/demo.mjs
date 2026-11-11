#!/usr/bin/env node
/**
 * 演示模式：持续注入多厂商思考事件，让壁纸进入「多 agent 并行思考」的演示状态。
 *
 *   npm run demo                 # 默认演示 2 分钟
 *   DEMO_MINUTES=5 npm run demo  # 演示 5 分钟
 *   Ctrl+C 随时提前结束
 *
 * 与本机真实数据完全隔离：
 *   1. 开始前备份 /stats（今日统计 + 上下文计量）与 /texts（思考文本墙）
 *   2. 注入的文本全部带「演示」标记，不混入任何真实会话内容
 *   3. 结束后原样还原 /stats 和 /texts
 *   4. 重启壁纸宿主：环带/看板内存里的演示文本一并清掉，从还原后的真实文本重新填充
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.THINKING_DESKTOP_URL || "http://127.0.0.1:7799";
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MINUTES = Number(process.env.DEMO_MINUTES || 2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let TOKEN = process.env.TD_TOKEN || "";
if (!TOKEN) { try { TOKEN = readFileSync(join(ROOT, "data", ".token"), "utf8").trim(); } catch {} }
const api = (path, opts = {}) =>
  fetch(`${BASE}${path}`, { ...opts, headers: { ...(TOKEN ? { "x-td-token": TOKEN } : {}), ...(opts.headers || {}) } });

/** 演示文本：明显带「演示」标记，不与真实思考混淆 */
const SCRIPT = {
  "kimi-desktop": [
    "演示 · 正在分析壁纸粒子参数，准备把环带转速调到舒适档。",
    "演示 · 尾随 wire.jsonl 拿到新的 think 片段，按前缀替换上墙。",
    "演示 · 检测到多厂商并行，准备把画面按强度加权混色。",
    "演示 · 上下文占用 18%，一切都在安全范围内。",
  ],
  "deepseek-harness": [
    "演示 · 会话 zstd 解码完成，提取到三段完整推理。",
    "演示 · 把 reasoning 整段铺进环带数据块，不重排版式。",
    "演示 · 工具调用 bash 返回成功，继续下一阶段。",
  ],
  codex: [
    "演示 · rebuild index, re-run tool trace, diff looks clean.",
    "演示 · the patch applies cleanly; running tests once more.",
    "演示 · token usage steady, no compaction needed yet.",
  ],
  "gemini-desktop": [
    "演示 · 总结会议纪要，提炼三个行动项。",
    "演示 · 对比两个草案，列出事实性差异。",
  ],
  "chatgpt-desktop": [
    "演示 · draft release notes for the wallpaper update.",
    "演示 · give me a pre-ship checklist in plain terms.",
  ],
};
const SOURCES = Object.keys(SCRIPT);
const TOOLS = ["bash", "Read", "Grep", "Edit", "FetchURL"];

let stopped = false;
process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });

async function post(source, type, payload) {
  const res = await api("/ingest", { method: "POST", body: JSON.stringify({ source, type, payload }) });
  if (!res.ok) throw new Error(`ingest ${source} ${type} → ${res.status}`);
}

const backup = { stats: null, texts: null };
async function snapshotState() {
  try { backup.stats = await (await api("/stats")).json(); } catch {}
  try { backup.texts = await (await api("/texts?limit=40")).json(); } catch {}
  return backup.stats?.totalEvents ?? null;
}
async function restoreState() {
  if (backup.stats) await api("/stats", { method: "POST", body: JSON.stringify(backup.stats) });
  if (backup.texts) await api("/texts", { method: "POST", body: JSON.stringify(backup.texts) });
}

async function restartWallpaper() {
  // launchd 守护的壁纸宿主：kickstart 重启后页面从还原后的 /texts 重新填充
  try {
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync("launchctl", ["kickstart", "-k", `gui/${process.getuid()}/com.simwecan.thinking-desktop-wallpaper`], { encoding: "utf8" });
    return r.status === 0;
  } catch { return false; }
}

const until = Date.now() + MINUTES * 60_000;
console.log(`演示模式 → ${BASE}`);
console.log(`持续 ${MINUTES} 分钟（Ctrl+C 提前结束）；真实统计与文本墙已备份，结束后自动还原并重启壁纸。`);

const before = await snapshotState();
console.log(`备份完成：今日 ${before ?? "?"} 个真实事件 / 文本墙 ${backup.texts?.length ?? 0} 条。`);

let i = 0;
try {
  while (!stopped && Date.now() < until) {
    for (const src of SOURCES) {
      const lines = SCRIPT[src];
      // 每家节奏错开：不是五家整齐划一，而是此起彼伏，更像真实并行
      if ((i + SOURCES.indexOf(src)) % 3 === 2) continue;
      await post(src, "text", { text: lines[i % lines.length], kind: "think", stream: true });
      if (i % 2 === 0) await post(src, "tool_call", { name: TOOLS[(i / 2 | 0) % TOOLS.length] });
      if (i % 4 === 1) {
        if (src === "deepseek-harness") await post(src, "token", { model: "deepseek-flash", used: 200000 + i * 8000, window: 1048576 });
        else await post(src, "token", { model: src.replace("-desktop", ""), maxUsage: Math.min(0.85, 0.15 + i * 0.02) });
      }
    }
    i += 1;
    if (i % 15 === 0) {
      const d = await (await api("/debug")).json();
      const t = d.clients?.wall ?? {};
      console.log(`  [${new Date().toLocaleTimeString()}] 点亮: ${(t.lights || []).join("+") || "—"} · 环带文本 ${t.haloText ?? 0} 条`);
    }
    await sleep(900);
  }
} finally {
  console.log("\n演示结束，正在还原真实数据…");
  await restoreState();
  const restarted = await restartWallpaper();
  const after = await (await api("/stats")).json().catch(() => null);
  console.log(`已还原：今日事件 ${after?.totalEvents ?? "?"} 个（演示前 ${before ?? "?"}）· 文本墙 ${(await (await api("/texts?limit=40")).json()).length} 条`);
  console.log(restarted ? "壁纸宿主已重启，环带从真实数据重新填充。" : "⚠ 壁纸宿主重启失败，请手动重启以清掉内存中的演示文本。");
}
