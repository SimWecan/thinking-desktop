#!/usr/bin/env node
/**
 * 用「今天」的真实会话回填壁纸的思考流，清掉演示/模拟数据。
 *
 *   npm run backfill            # 回填今天（本机时区 00:00 起）
 *   BACKFILL_DAYS=2 npm run backfill
 *
 * 数据来源：
 *   - DeepSeek Harness：~/.dsh/sessions/<workspace>/session-<id>/*.jsonl.zstd（assistant/message 的 reasoning / text）
 *   - Kimi 桌面端：.../kimi-code/home/sessions/<ws>/conv-<id>/.../wire.jsonl（content.part 的 think/text、assistant 消息）
 * 只写 data/texts.json（服务端启动时加载），不伪造任何事件；工具/上下文统计由真实事件自然重建。
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HOME = homedir();
const DAYS = Math.max(1, Number(process.env.BACKFILL_DAYS || 1));
const LIMIT = Number(process.env.BACKFILL_LIMIT || 36);
const MAX_CHARS = 2000;

const dayStart = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime() - (DAYS - 1) * 86_400_000;
})();

const clean = (s) => String(s ?? "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();

function walk(dir, depth = 0) {
  const out = [];
  if (depth > 4 || !existsSync(dir)) return out;
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    const p = join(dir, n);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) out.push(...walk(p, depth + 1));
    else out.push({ path: p, mtimeMs: st.mtimeMs });
  }
  return out;
}

// ---------- DeepSeek Harness ----------
function collectDsh() {
  const out = [];
  const dir = join(HOME, ".dsh", "sessions");
  for (const f of walk(dir)) {
    if (!f.path.endsWith(".jsonl.zstd") || f.mtimeMs < dayStart) continue;
    let text = "";
    try {
      text = execFileSync("zstd", ["-q", "-d", "-c", f.path], { maxBuffer: 64 * 1024 * 1024, encoding: "utf8" });
    } catch { continue; }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (o.type !== "assistant/message") continue;
      const ts = Number(o.time) || 0;
      if (ts < dayStart) continue;
      const blocks = o.data?.message?.content;
      if (!Array.isArray(blocks)) continue;
      const think = blocks.filter((b) => b?.type === "reasoning" && b.text).map((b) => b.text).join("\n");
      const out2 = blocks.filter((b) => b?.type === "text" && b.text).map((b) => b.text).join("\n");
      const body = clean(think || out2);
      if (body.length < 8) continue;
      out.push({ source: "deepseek-harness", ts, kind: think ? "think" : "output", text: body.slice(0, MAX_CHARS) });
    }
  }
  return out;
}

// ---------- Kimi ----------
function collectKimi() {
  const out = [];
  const dir = join(HOME, "Library", "Application Support", "kimi-desktop", "daimon-share", "daimon",
    "runtime", "kimi-code", "home", "sessions");
  for (const f of walk(dir)) {
    if (!f.path.endsWith("wire.jsonl") || f.mtimeMs < dayStart) continue;
    let raw = "";
    try {
      if (statSync(f.path).size > 24 * 1024 * 1024) continue;
      raw = readFileSync(f.path, "utf8");
    } catch { continue; }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      const ts = Number(o.time) || f.mtimeMs;
      if (ts < dayStart) continue;
      if (o.type === "agent.message.appended") {
        const m = o.message?.message;
        if (m?.role !== "assistant") continue;
        const body = clean(Array.isArray(m.content) ? m.content.map((c) => c?.text || "").join("\n") : m.content);
        if (body.length < 8) continue;
        out.push({ source: "kimi-desktop", ts, kind: "output", text: body.slice(0, MAX_CHARS) });
      } else if (o.type === "context.append_loop_event" && o.event?.type === "content.part") {
        const p = o.event.part;
        const body = clean(p?.type === "think" ? p.think : p?.type === "text" ? p.text : "");
        if (body.length < 8) continue;
        out.push({ source: "kimi-desktop", ts, kind: p.type === "think" ? "think" : "output", text: body.slice(0, MAX_CHARS) });
      }
    }
  }
  return out;
}

const all = [...collectDsh(), ...collectKimi()]
  .filter((e) => Number.isFinite(e.ts))
  .sort((a, b) => a.ts - b.ts);

// 去重：完全重复 / 前缀包含（流式快照）
const kept = [];
for (const e of all) {
  const prev = kept[kept.length - 1];
  if (prev && prev.source === e.source) {
    if (prev.text === e.text) continue;
    if (prev.text.startsWith(e.text) || e.text.startsWith(prev.text)) {
      if (e.text.length > prev.text.length) kept[kept.length - 1] = e;
      continue;
    }
  }
  kept.push(e);
}

// 按来源配额取样，避免「最近 36 条」被单一来源刷满（比如 DSH 一直在用，Kimi 上午的就被挤掉了）
const groups = new Map();
for (const e of kept) {
  if (!groups.has(e.source)) groups.set(e.source, []);
  groups.get(e.source).push(e);
}
const quota = Math.max(6, Math.round(LIMIT / Math.max(1, groups.size)));
const picked = [];
for (const list of groups.values()) {
  if (list.length <= quota) { picked.push(...list); continue; }
  // 在整天的范围里等距取样，而不是只取最后半小时（否则全是刚发生的那一段）
  const stride = list.length / quota;
  for (let i = 0; i < quota; i++) picked.push(list[Math.min(list.length - 1, Math.floor(i * stride))]);
}
const final = picked.sort((a, b) => a.ts - b.ts).slice(-Math.max(LIMIT, quota * groups.size));
const outFile = join(ROOT, "data", "texts.json");
writeFileSync(outFile, JSON.stringify(final, null, 0));

// 若服务在跑，直接原子替换服务端缓冲（否则它下次写盘会把这里覆盖回去）
const BASE = process.env.THINKING_DESKTOP_URL || "http://127.0.0.1:7799";
try {
  const r = await fetch(`${BASE}/texts`, { method: "POST", body: JSON.stringify(final) });
  const j = await r.json();
  console.log("服务端缓冲已替换:", j.count, "条");
} catch {
  console.log("服务未运行，已只写文件（下次启动会自动加载）");
}

const bySource = final.reduce((m, e) => ((m[e.source] = (m[e.source] || 0) + 1), m), {});
console.log(`回填 ${final.length} 条（${DAYS} 天，起始 ${new Date(dayStart).toLocaleString()}）`);
console.log("按来源:", bySource);
console.log("时间范围:", final.length ? `${new Date(final[0].ts).toLocaleString()} → ${new Date(final.at(-1).ts).toLocaleString()}` : "—");
console.log("写入:", outFile);
