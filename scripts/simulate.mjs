#!/usr/bin/env node
/**
 * 多 agent 并行模拟：往本机服务注入多个厂商的思考事件，验证壁纸是否真的
 * 同时呈现多种颜色的光效 + 环带文本。
 *
 *   npm run simulate            # 默认 http://127.0.0.1:7799
 *   SIM_OUT=/tmp/td-sim npm run simulate
 *
 * 每个阶段持续数秒地注入事件，然后请求一帧画布快照（/snapshot），
 * 并校验 /debug 里壁纸实际点亮的来源集合。结束后打印各阶段的主色。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.THINKING_DESKTOP_URL || "http://127.0.0.1:7799";
const OUT = process.env.SIM_OUT || "/tmp/td-sim";
const SECONDS = Number(process.env.SIM_SECONDS || 5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SAMPLES = {
  "kimi-desktop": [
    "先把 connector 的增量读取改稳：按行号偏移，不重复上报。",
    "wire.jsonl 里 think 片段是快照，同一段会越写越长，按前缀替换。",
    "检查一下 tools.register_user_tool 的行型，别把心跳当活动。",
  ],
  "deepseek-harness": [
    "会话是 zstd 多帧追加写的，整文件解码后按行差量提取。",
    "把 reasoning 整段上墙，不要截成一句话。",
    "多厂商并行时按强度加权混色，环带再分道显示各自颜色。",
  ],
  codex: [
    "rebuild the sqlite index and re-run the tool trace.",
    "log level DEBUG rows are noise; only tool/turn lines matter.",
    "the patch applies cleanly; run the tests again after rebase.",
  ],
  "gemini-desktop": [
    "summarize the meeting notes into three bullet points.",
    "compare the two drafts and list the factual differences.",
    "把这段中文润色一下，保持技术术语不变。",
  ],
  "chatgpt-desktop": [
    "draft a short release note for the wallpaper update.",
    "explain the color system to a new contributor in plain terms.",
    "give me a checklist before shipping this build.",
  ],
};

const pick = (arr, i) => arr[i % arr.length];

async function post(source, type, payload) {
  const res = await fetch(`${BASE}/ingest`, {
    method: "POST",
    body: JSON.stringify({ source, type, payload }),
  });
  if (!res.ok) throw new Error(`ingest ${source} ${type} → ${res.status}`);
}

async function snapshot(name) {
  await fetch(`${BASE}/snapshot?request=1`).catch(() => {});
  await sleep(1600);
  const res = await fetch(`${BASE}/snapshot`);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  const file = join(OUT, `${name}.png`);
  writeFileSync(file, buf);
  return file;
}

async function telemetry() {
  const d = await (await fetch(`${BASE}/debug`)).json();
  return d.clients?.wall ?? {};
}

async function phase(name, sources) {
  const until = Date.now() + SECONDS * 1000;
  let i = 0;
  while (Date.now() < until) {
    for (const src of sources) {
      await post(src, "text", { text: pick(SAMPLES[src] ?? ["…"], i), kind: "think" });
      await post(src, "tool_call", { name: "bash" });
      await post(src, "tool_result", {});
    }
    i += 1;
    await sleep(800);
  }
  await sleep(300);
  const before = await telemetry();
  const file = await snapshot(name);
  const t = await telemetry();
  const expect = sources.filter((s) => s !== "deepseek-harness");
  const got = t.lights || [];
  const missing = expect.filter((s) => !got.includes(s));
  console.log(`\n[${name}]`);
  console.log(`  壁纸点亮: ${got.join(", ") || "（无）"}`);
  console.log(`  halo 收到: ${(t.haloGeom?.lights?.srcs || []).join(", ") || "（无）"}`);
  console.log(`  环带文本: ${t.haloText ?? 0} 条 / 重绘 ${t.haloGeom?.paints ?? 0} 次`);
  console.log(`  快照: ${file ?? "（不可用）"}`);
  if (missing.length) console.log(`  ⚠ 未点亮: ${missing.join(", ")}`);
  return { name, got, missing, file, haloText: t.haloText, paints: t.haloGeom?.paints };
}

const t0 = Date.now();
mkdirSync(OUT, { recursive: true });
console.log(`多 agent 并行模拟 → ${BASE}`);
console.log(`每阶段 ${SECONDS}s，输出到 ${OUT}`);

const baseline = await phase("0-baseline", []);
const results = [baseline];
results.push(await phase("1-dsh+kimi", ["kimi-desktop"]));
results.push(await phase("2-+codex", ["kimi-desktop", "codex"]));
results.push(await phase("3-+gemini", ["kimi-desktop", "codex", "gemini-desktop"]));
results.push(await phase("4-all", ["kimi-desktop", "codex", "gemini-desktop", "chatgpt-desktop"]));

const bad = results.filter((r) => r.missing.length);
console.log(`\n=== 结论 ===`);
console.log(`阶段数 ${results.length}，耗时 ${Math.round((Date.now() - t0) / 1000)}s`);
console.log(bad.length ? `有 ${bad.length} 个阶段未点亮预期来源` : `所有预期来源都已同时点亮`);
console.log(`快照目录: ${OUT}`);
process.exit(bad.length ? 1 : 0);
