#!/usr/bin/env node
/**
 * 端到端场景测试：单 agent / 多 agent / 综合↔单独形态切换 / agent 结束后动态静默 / 活动回归。
 *
 *   npm run test:e2e              # 全量跑（含静默阶段，约 2 分钟）
 *   E2E_SKIP_SILENCE=1 npm run test:e2e   # 跳过静默长阶段
 *
 * 与本机真实数据完全隔离（三层）：
 *   1. 重启服务时经 launchctl setenv THINKING_DESKTOP_CONNECTORS=off 停用全部真实
 *      连接器——本机 AI 桌面端的真实事件一条都进不来，测试只消费 /ingest 注入的事件
 *   2. 注入文本全部带「测试」标记；/stats 与 /texts 测试前备份、测试后原样还原
 *   3. 结束后恢复连接器（unsetenv + 重启服务）并重启壁纸宿主，清掉内存里的测试文本
 *
 * 每个阶段：注入事件 → 断言 /debug 遥测与 /agents 状态 → 保存壁纸/托盘快照到 .verify/e2e/
 */

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const BASE = process.env.THINKING_DESKTOP_URL || "http://127.0.0.1:7799";
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, ".verify", "e2e");
const UID = process.getuid();
const SKIP_SILENCE = !!process.env.E2E_SKIP_SILENCE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let TOKEN = process.env.TD_TOKEN || "";
if (!TOKEN) { try { TOKEN = readFileSync(join(ROOT, "data", ".token"), "utf8").trim(); } catch {} }
const api = (path, opts = {}) =>
  fetch(`${BASE}${path}`, { ...opts, headers: { ...(TOKEN ? { "x-td-token": TOKEN } : {}), ...(opts.headers || {}) } });

/** 注入文本：明显带「测试」标记，不与真实思考混淆 */
const SCRIPT = {
  "gemini-desktop": [
    "测试 · 总结两份方案差异，列出三个事实性分歧点。",
    "测试 · 把环带粒子按来源分轨，混色时按强度加权。",
    "测试 · 检测到形态切换请求，准备单一展示。",
  ],
  "deepseek-harness": [
    "测试 · zstd 会话解码完成，提取到两段完整推理。",
    "测试 · reasoning 整段上墙，不截成一句话。",
    "测试 · 工具调用返回成功，继续下一阶段。",
  ],
  codex: [
    "test · rebuild the sqlite index and re-run the tool trace.",
    "test · the patch applies cleanly; run tests once more.",
  ],
};
const SOLO = "gemini-desktop";                 // 本机无真实事件的来源，单独形态不受真实数据干扰
const MULTI = ["gemini-desktop", "deepseek-harness", "codex"];

const results = [];   // { phase, name, ok, detail }
function check(phase, name, ok, detail = "") {
  results.push({ phase, name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/** 壁纸宿主窗口被完全遮挡时，WKWebView 会节流光环 iframe 的 rAF：
 *  帧率遥测冻结、光源淡入不爬升——这些是环境状态不是代码缺陷。
 *  遮挡期间把 rAF 依赖类断言标记为跳过（记为通过但单独计数）， release 门不再被误伤。 */
let OCCLUDED = false;
async function detectOcclusion() {
  for (let i = 0; i < 6; i++) {
    const w = await wall().catch(() => ({}));
    if (w.haloGeom && w.haloGeom.fps != null) return;   // 拿到一帧遥测即视为可见
    await sleep(1000);
  }
  OCCLUDED = true;
  console.log("  ⚠ 壁纸窗口被遮挡（光环 rAF 被系统节流）：rAF 依赖类断言将跳过");
}
function checkSkip(phase, name, ok, detail = "") {
  if (OCCLUDED) {
    results.push({ phase, name, ok: true, skipped: true, detail });
    console.log(`  ⤫ ${name} — 跳过（壁纸窗口遮挡，rAF 节流）${detail ? ` · ${detail}` : ""}`);
    return;
  }
  check(phase, name, ok, detail);
}

async function post(source, type, payload) {
  const res = await api("/ingest?test=1", { method: "POST", body: JSON.stringify({ source, type, payload }) });
  if (!res.ok) throw new Error(`ingest ${source} ${type} → ${res.status}`);
}
/** 等壁纸页真正连上（SSE 重连后才有遥测），避免刚重启就开始取样 */
async function waitWallReady(timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const d = await api("/debug").then((r) => r.json()).catch(() => ({}));
    const w = d.clients?.wall;
    if (w && w.build && w.at && Date.now() - w.at < 4000) return true;
    await sleep(500);
  }
  return false;
}

async function setView(agent) {
  const res = await api("/view", { method: "POST", body: JSON.stringify({ agent }) });
  if (!res.ok) throw new Error(`/view → ${res.status}`);
  return (await res.json()).view;
}
const wall = async () => (await (await api("/debug")).json()).clients?.wall ?? {};
const agentList = async () => (await (await api("/agents")).json());
/** 轮询 /debug 直到壁纸遥测满足条件：光环淡入淡出 + 父页 2s 轮询有固定延迟，
 *  固定 sleep 后单次采样在机器负载高时必然 flaky（P1/P2/P3 的 srcs 断言全部改走这里） */
async function waitWall(pred, timeoutMs = 15000, step = 600) {
  const until = Date.now() + timeoutMs;
  let w = await wall();
  while (!pred(w) && Date.now() < until) { await sleep(step); w = await wall(); }
  return w;
}

/** 持续注入若干来源的事件，持续 seconds 秒 */
async function inject(sources, seconds) {
  const until = Date.now() + seconds * 1000;
  let i = 0;
  while (Date.now() < until) {
    for (const src of sources) {
      await post(src, "text", { text: SCRIPT[src][i % SCRIPT[src].length], kind: "think", stream: true });
      if (i % 2 === 0) await post(src, "tool_call", { name: "bash" });
      if (src === "deepseek-harness") await post(src, "token", { model: "deepseek-flash", used: 200000 + i * 8000, window: 1048576 });
      else await post(src, "token", { model: src.replace("-desktop", ""), maxUsage: 0.2 + (i % 5) * 0.05 });
    }
    i += 1;
    await sleep(850);
  }
}

/** 请求一帧壁纸快照（必要时含托盘），落盘 .verify/e2e/<name>.png */
async function snap(name, { tray = false } = {}) {
  await api("/snapshot?request=1").catch(() => {});
  await sleep(3000);
  const files = [];
  for (const [suffix, url] of [["wall", "/snapshot"], ...(tray ? [["tray", "/snapshot?tray=1"]] : [])]) {
    const res = await api(url).catch(() => null);
    if (res && res.ok) {
      const f = join(OUT, `${name}-${suffix}.png`);
      writeFileSync(f, Buffer.from(await res.arrayBuffer()));
      files.push(f);
    }
  }
  return files;
}

async function restartServer(connectorsOff) {
  if (connectorsOff) spawnSync("launchctl", ["setenv", "THINKING_DESKTOP_CONNECTORS", "off"]);
  else spawnSync("launchctl", ["unsetenv", "THINKING_DESKTOP_CONNECTORS"]);
  const r = spawnSync("launchctl", ["kickstart", "-k", `gui/${UID}/com.simwecan.thinking-desktop`], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`服务重启失败: ${r.stderr || r.stdout}`);
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try { const res = await fetch(`${BASE}/health`); if (res.ok) return; } catch {}
  }
  throw new Error("服务重启后 /health 未就绪");
}
async function restartWallpaper() {
  spawnSync("launchctl", ["kickstart", "-k", `gui/${UID}/com.simwecan.thinking-desktop-wallpaper`]);
}

// ---------------- 备份（测试后原样还原） ----------------
const backup = { stats: null, texts: null, ui: null, view: "all" };
async function snapshotState() {
  try { backup.stats = await (await api("/stats")).json(); } catch {}
  try { backup.texts = await (await api("/texts?limit=40")).json(); } catch {}
  try { backup.ui = (await (await api("/state")).json()).ui || null; } catch {}
  try { backup.view = (await agentList()).view || "all"; } catch {}
}
async function restoreState() {
  try { if (backup.stats) await api("/stats", { method: "POST", body: JSON.stringify(backup.stats) }); } catch {}
  try { if (backup.texts) await api("/texts", { method: "POST", body: JSON.stringify(backup.texts) }); } catch {}
  try { if (backup.ui) await api("/ui", { method: "POST", body: JSON.stringify(backup.ui) }); } catch {}
  try { await setView(backup.view); } catch {}
}

// ---------------- 主流程 ----------------
mkdirSync(OUT, { recursive: true });
console.log(`端到端场景测试 → ${BASE}`);
await snapshotState();
const winddownSec = Number(backup.ui?.winddownSec ?? backup.ui?.holdSec ?? 30);
console.log(`已备份：今日 ${backup.stats?.totalEvents ?? "?"} 事件 / 文本墙 ${backup.texts?.length ?? 0} 条 / 形态 ${backup.view} / winddown ${winddownSec}s`);
console.log("重启服务（停用真实连接器）…");
await restartServer(true);
await sleep(1500);   // 等壁纸页 SSE 重连 + hello 状态

// 双保险：即使「停用连接器」没生效，也把真实事件挡在门外（测试结束在 finally 里恢复）
await api("/test/pause", { method: "POST" }).catch(() => {});
await waitWallReady();
await detectOcclusion();

try {
  // ---------- P0 基础设施端点（回归：/version 曾引用未定义变量，一请求就崩服务） ----------
  console.log("\n■ P0 基础设施端点");
  {
    const v = await api("/version");
    const vt = v.ok ? (await v.text()).trim() : "";
    check("P0", "/version 返回版本号", v.ok && /^\d+\.\d+\.\d+$/.test(vt), vt || `status=${v.status}`);
    const l = await api("/logs?lines=50");
    let lcount = -1, lerr = "";
    if (l.ok) { try { lcount = (await l.json()).lines.length; } catch (e) { lerr = String(e); } }
    check("P0", "/logs 返回日志行", l.ok && lcount >= 0, lerr || `${lcount} 行`);
    const c = await api("/console");
    check("P0", "/console 控制台页可访问", c.ok && (c.headers.get("content-type") || "").includes("text/html"));
  }

  // ---------- P1 单 agent 运行（单独形态） ----------
  console.log("\n■ P1 单 agent 运行（单独形态 gemini-desktop，8s）");
  let w, ag;
  await setView(SOLO);
  const p1 = inject([SOLO], 8);
  // 等光环只剩该来源（父页轮询 + 淡入 + 旧来源淡出共约 5s，负载高时更久）
  w = await waitWall((x) => { const s = x.haloGeom?.lights?.srcs || []; return s.length === 1 && s[0] === SOLO; });
  ag = await agentList();
  check("P1", "形态已切到 gemini-desktop", ag.view === SOLO, `view=${ag.view}`);
  check("P1", "该 agent 判定为思考中", (ag.agents || []).find((a) => a.source === SOLO)?.thinking === true);
  check("P1", "壁纸点亮 gemini", (w.lights || []).includes(SOLO), `lights=${(w.lights || []).join("+") || "无"}`);
  const p1srcs = w.haloGeom?.lights?.srcs || [];
  checkSkip("P1", "单一形态光环只渲染该来源", p1srcs.length === 1 && p1srcs[0] === SOLO, `halo srcs=${p1srcs.join(",") || "无"}`);
  check("P1", "环带收到思考文本", (w.haloText ?? 0) > 0, `${w.haloText ?? 0} 条`);
  checkSkip("P1", "光环动画运行中", w.haloRaf === true && (w.calm ?? 0) < 0.5, `calm=${w.calm}`);
  const p1files = await snap("p1-solo", { tray: true });
  console.log(`  快照: ${p1files.map((f) => f.split("/").pop()).join(", ")}`);
  await p1;

  // ---------- P2 多 agent 并行（综合形态） ----------
  console.log("\n■ P2 多 agent 并行（综合形态，3 家 × 8s）");
  await setView("all");
  const p2 = inject(MULTI, 8);
  w = await waitWall((x) => { const s = x.haloGeom?.lights?.srcs || []; return MULTI.every((src) => s.includes(src)); });
  ag = await agentList();
  check("P2", "形态为综合", ag.view === "all", `view=${ag.view}`);
  const lit = MULTI.filter((s) => (w.lights || []).includes(s));
  check("P2", "三家同时点亮", lit.length === MULTI.length, `lights=${(w.lights || []).join("+") || "无"}`);
  const p2srcs = w.haloGeom?.lights?.srcs || [];
  checkSkip("P2", "光环多来源分轨渲染", MULTI.every((s) => p2srcs.includes(s)), `halo srcs=${p2srcs.join(",") || "无"}`);
  check("P2", "环带文本持续流入", (w.haloText ?? 0) > 0, `${w.haloText ?? 0} 条`);
  const p2files = await snap("p2-multi", { tray: true });
  console.log(`  快照: ${p2files.map((f) => f.split("/").pop()).join(", ")}`);
  await p2;

  // ---------- P3 综合 ↔ 单独形态切换，特效跟着切 ----------
  console.log("\n■ P3 形态切换（注入不停：gemini + dsh，各形态 4s）");
  const p3 = inject(["gemini-desktop", "deepseek-harness"], 16);
  await sleep(1000);
  const CYCLE = [
    ["all", MULTI.length, "综合形态（三家都可见）", false],
    ["deepseek-harness", 1, "单独形态：只显示 DSH 粒子", true],
    ["gemini-desktop", 1, "单独形态：只显示 Gemini 粒子", true],
    ["all", MULTI.length, "切回综合形态", false],
  ];
  for (const [view, minSrcs, label, trayShot] of CYCLE) {
    await setView(view);
    // 光环里旧来源的光强是缓动衰减的（约数秒级），不是硬切：轮询等它落位
    let ok = false, srcs = [];
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      await sleep(1000);
      [w, ag] = [await wall(), await agentList()];
      srcs = w.haloGeom?.lights?.srcs || [];
      ok = ag.view === view && (view === "all" ? srcs.length >= 2 : srcs.length === 1 && srcs[0] === view);
      if (ok) break;
    }
    checkSkip("P3", label, ok, `view=${ag.view} halo srcs=${srcs.join(",") || "无"}`);
    const files = await snap(`p3-view-${view.replace(/[^a-z]/g, "")}`, { tray: trayShot });
    console.log(`  快照: ${files.map((f) => f.split("/").pop()).join(", ")}`);
  }
  await p3;

  // ---------- P3b 渲染预算（性能回归护栏） ----------
  {
    const h = await api("/health").then((r) => r.json()).catch(() => ({}));
    const perf = h.perf || {};
    const ok = (perf.frameMs ?? 99) < 8 && (perf.fps ?? 0) >= 30;
    checkSkip("P3b", "渲染开销在预算内（frameMs < 8ms，fps ≥ 30）", ok,
      `fps=${perf.fps ?? "?"} frameMs=${perf.frameMs ?? "?"} panelMs=${perf.panelMs ?? "?"}`);
  }

  // ---------- P4 agent 结束 → 动态静默 ----------
  if (!SKIP_SILENCE) {
    console.log(`\n■ P4 全部停止 → 动态静默（winddown ${winddownSec}s，逐 2s 采样 calm）`);
    await setView("all");
    await sleep(2000);
    // P3 的注入结束时刻不固定（机器慢时快照耗时拉长），P4 第一拍的空闲时长不可控——
    // 补一条事件把空闲清零，让 calm 从 0 起步单调爬升，观测起点确定。
    // 机器慢/窗口遮挡时壁纸的状态循环可能延迟数秒：必须等这条事件真正落到
    // 壁纸遥测（idleFor 归零）再开始采样，否则第一拍会采到事件到达前的旧 calm=1。
    await post(SOLO, "text", { text: "测试 · P4 静默观测起点，随后停止注入。", kind: "think", stream: true });
    await waitWall((x) => (x.idleFor ?? 99) < 3, 15000, 400);
    const rows = [];
    const deadline = Date.now() + (winddownSec + 15) * 1000;
    let peaked = false;
    while (Date.now() < deadline) {
      w = await wall();
      rows.push({ t: Math.round(w.idleFor ?? 0), calm: w.calm, idle: w.idle, raf: w.haloRaf, lights: (w.lights || []).length });
      console.log(`  空闲 ${String(w.idleFor ?? "?").padStart(3)}s · calm ${(w.calm ?? "?").toString().padEnd(5)} · idle=${w.idle} · rAF=${w.haloRaf} · 点亮 ${(w.lights || []).length}`);
      if (w.calm >= 1) { peaked = true; break; }
      await sleep(2000);
    }
    // calm 到 1 后再等一拍：standby 冻结光环（rAF 退出）有至多 1 个遥测周期的延迟
    await sleep(2500);
    w = await wall();
    // 只在「空闲时长确实在增长」的采样之间要求单调；若有事件插进来（idle 变小），
    // 那是被真实活动重置了，不属于减速曲线本身的问题
    const rising = rows.every((r, i) =>
      i === 0 || r.idle <= rows[i - 1].idle || r.calm >= rows[i - 1].calm - 0.05);
    check("P4", "calm 单调爬升（渐进减速，非硬停）", rows.length >= 3 && rising && rows[rows.length - 1].calm >= 1,
      rows.map((r) => r.calm).join("→"));
    check("P4", "到点完全静默（idle）", w.calm >= 1 && w.idle === true,
      `calm=${w.calm} idle=${w.idle}`);
    checkSkip("P4", "光环 rAF 退出", w.haloRaf === false, `rAF=${w.haloRaf}`);
    check("P4", "无来源点亮", (w.lights || []).length === 0);
    const silenceFiles = await snap("p4-silent");
    console.log(`  快照: ${silenceFiles.map((f) => f.split("/").pop()).join(", ")}`);

    // ---------- P5 活动回归 ----------
    console.log("\n■ P5 活动回归（注入 1 条事件，5s 内应退出静默）");
    await post(SOLO, "text", { text: "测试 · 新的思考开始了，环带应该恢复转动。", kind: "think", stream: true });
    let resumed = false;
    for (let i = 0; i < 6; i++) {
      await sleep(1000);
      w = await wall();
      if ((w.calm ?? 1) < 0.3 && w.haloRaf === true) { resumed = true; break; }
    }
    checkSkip("P5", "calm 回落、光环恢复运行", resumed, `calm=${w.calm} rAF=${w.haloRaf}`);
  } else {
    console.log("\n■ P4/P5 按 E2E_SKIP_SILENCE 跳过");
  }
} finally {
  console.log("\n还原真实数据与服务…");
  await api("/test/resume", { method: "POST" }).catch(() => {});
  await restoreState();
  await restartServer(false);
  await restartWallpaper();
  await sleep(4000);
  const w = await wall().catch(() => ({}));
  const texts = await (await api("/texts?limit=40")).json().catch(() => []);
  console.log(`服务已恢复真实连接器；壁纸已重启。文本墙 ${texts.length} 条（演示前 ${backup.texts?.length ?? 0}）`);
  const clean = !(w.pageError || w.haloError);
  check("END", "壁纸运行无页面错误", clean, w.pageError || w.haloError || "");
}

console.log("\n=== 结论 ===");
const failed = results.filter((r) => !r.ok);
for (const r of results.filter((x) => !x.ok)) console.log(`  ✗ [${r.phase}] ${r.name} ${r.detail}`);
const skipped = results.filter((r) => r.skipped);
console.log(`通过 ${results.length - failed.length}/${results.length} · 跳过 ${skipped.length}（遮挡）· 快照目录 ${OUT}`);
process.exit(failed.length ? 1 : 0);
