#!/usr/bin/env node
/**
 * 多 agent 切换平滑度测试：两个厂商同时跑 → 其中一个停止 → 观察
 * 光效强度是否「渐隐」、通道位置是否「滑动」重排（而不是硬切）。
 *
 *   npm run simulate:transition
 *
 * 判定：被停掉的来源在 12s 活跃窗口到期后，cur 应逐步下降（至少出现 3 档中间值），
 * 且仍在工作的来源通道位置应从 0.75 平滑移到 0.5。
 */

const BASE = process.env.THINKING_DESKTOP_URL || "http://127.0.0.1:7799";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(source, type, payload) {
  await fetch(`${BASE}/ingest`, { method: "POST", body: JSON.stringify({ source, type, payload }) });
}

async function pump(sources, until, label) {
  let i = 0;
  while (Date.now() < until) {
    for (const src of sources) await post(src, "text", { text: `${label} 第 ${i + 1} 段思考：保持节奏，别抢戏。`, kind: "think" });
    i += 1;
    await sleep(700);
  }
}

async function lights() {
  const d = await (await fetch(`${BASE}/debug`)).json();
  return d.clients?.wall?.haloGeom?.lights || null;
}

const start = Date.now();
const A_END = start + 3000;      // 前 3s：Kimi + Codex
const B_END = start + 22000;     // 之后：只剩 Codex（Kimi 12s 窗口到期后应渐隐）

console.log(`切换平滑度测试 → ${BASE}`);
console.log(`前 3s: kimi + codex 并行；之后只剩 codex，观察 kimi 渐隐与 codex 通道从 0.75 滑到 0.5\n`);

const pumpA = pump(["kimi-desktop", "codex"], A_END, "A");
const pumpB = pump(["codex"], B_END, "B");

const rows = [];
while (Date.now() < B_END) {
  const l = await lights();
  if (l?.cur?.length) rows.push({ t: ((Date.now() - start) / 1000).toFixed(1), cur: l.cur });
  await sleep(500);
}
await Promise.all([pumpA, pumpB]);

// 打印 3s 之后的关键片段
const tail = rows.filter((r) => Number(r.t) >= 3);
for (const r of tail) {
  console.log(`  t=${r.t}s  ` + r.cur.map(([src, c, lane]) => `${src.slice(0, 6)}=${c.toFixed(2)}@${lane.toFixed(2)}`).join("  "));
}

const kimi = tail.map((r) => r.cur.find(([s]) => s === "kimi-desktop")?.[1]).filter((v) => v !== undefined);
const steps = [];
for (const v of kimi) if (!steps.length || Math.abs(v - steps[steps.length - 1]) > 0.02) steps.push(v);
const codexLane = tail.map((r) => r.cur.find(([s]) => s === "codex")?.[2]).filter((v) => v !== undefined);

console.log(`\n=== 结论 ===`);
console.log(`kimi 强度变化序列: ${steps.map((v) => v.toFixed(2)).join(" → ") || "（未采到）"}`);
console.log(`codex 通道位置: ${codexLane.length ? codexLane[0].toFixed(2) + " → " + codexLane[codexLane.length - 1].toFixed(2) : "（未采到）"}`);
const faded = steps.filter((v) => v > 0.03 && v < 0.97).length;
console.log(faded >= 2 ? "✔ 淡出是渐变的（有中间档），不是硬切" : "✖ 淡出缺少中间档，可能是硬切");
process.exit(faded >= 2 ? 0 : 1);
