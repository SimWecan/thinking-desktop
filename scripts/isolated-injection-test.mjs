#!/usr/bin/env node
/**
 * 隔离数据注入测试：暂停真实连接器 → 注入测试事件 → 验证壁纸状态机 → 还原真实数据。
 *
 *   npm run test:injection
 *
 * 与本机真实数据完全隔离（与 demo.mjs 同一套机制）：
 *   1. POST /test/pause 暂停真实 agent 事件进入（测试事件带 __test 标记，不受暂停影响）
 *   2. 注入前备份 /stats 与 /texts，结束后原样 POST 还原
 *   3. 测试文本全部带「测试注入」标记
 *   4. 结束后重启壁纸宿主，清掉环带/看板内存中的测试文本
 *
 * 覆盖场景：单 agent 运行 / 多 agent 并行 / 综合↔单一形态切换 / 停止注入后动态静默
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { makeApi } from "./lib/http.mjs";

const BASE = process.env.THINKING_DESKTOP_URL || "http://127.0.0.1:7799";
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let TOKEN = process.env.TD_TOKEN || "";
if (!TOKEN) { try { TOKEN = readFileSync(join(ROOT, "data", ".token"), "utf8").trim(); } catch {} }
const api = makeApi({ base: BASE, token: TOKEN });   // 自带 ECONNRESET 重试

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const inject = async (source, type, payload) => {
  const res = await api(`/ingest?test`, {
    method: "POST",
    body: JSON.stringify({ source, type, payload }),
  });
  if (!res.ok) throw new Error(`ingest ${source}/${type} → ${res.status}`);
};

const getState = async () => (await api("/state")).json();
const getDebug = async () => (await api("/debug")).json();

// ---------- 0. 暂停真实连接器 + 备份真实数据 ----------
console.log("▶ 阶段 0：暂停真实连接器，备份 /stats 与 /texts");
await api("/test/pause", { method: "POST" });
const backup = {
  stats: await (await api("/stats")).json(),
  texts: await (await api("/texts?limit=40")).json(),
};
const st0 = await getState();
check("真实连接器已暂停（testPaused=true）", st0.testPaused === true);
console.log(`  备份：今日 ${backup.stats?.totalEvents ?? "?"} 个真实事件 / 文本墙 ${backup.texts?.length ?? 0} 条`);

try {
  // ---------- A. 单 agent 运行 ----------
  console.log("\n▶ 阶段 A：单 agent 运行（kimi-desktop）");
  for (let i = 0; i < 3; i++) {
    await inject("kimi-desktop", "text", { text: `测试注入 · 单 agent 阶段第 ${i + 1} 段思考`, kind: "think", stream: true });
    await sleep(400);
  }
  await sleep(1200); // 等壁纸轮询/SSE 跟上
  const stA = await getState();
  const srcA = Object.keys(stA.bySource);
  check("仅 kimi-desktop 一个来源活跃", srcA.length === 1 && srcA[0] === "kimi-desktop", `bySource=${JSON.stringify(stA.bySource)}`);
  check("壁纸收到活跃状态（idleMs < 5s）", stA.idleMs < 5000, `idleMs=${stA.idleMs}`);
  const dbgA = await getDebug();
  const wallA = dbgA.clients?.wall ?? {};
  if (wallA.lights) check("壁纸环带点亮 kimi-desktop", (wallA.lights || []).join(",") === "kimi-desktop", `lights=${JSON.stringify(wallA.lights)}`);
  else console.log("  ⤫ 壁纸遥测 lights 未上报（可能窗口被遮挡），跳过环带点亮断言");

  // ---------- B. 多 agent 并行 ----------
  console.log("\n▶ 阶段 B：多 agent 并行（kimi + deepseek + codex）");
  for (let i = 0; i < 3; i++) {
    await inject("deepseek-harness", "text", { text: `测试注入 · 并行阶段 deepseek 第 ${i + 1} 段`, kind: "think", stream: true });
    await inject("codex", "text", { text: `测试注入 · parallel phase codex line ${i + 1}`, kind: "think", stream: true });
    await sleep(400);
  }
  await inject("kimi-desktop", "tool_call", { name: "Bash" });
  await inject("codex", "tool_call", { name: "Edit" });
  await sleep(1500);
  const stB = await getState();
  const srcB = Object.keys(stB.bySource).sort();
  check("三个来源同时活跃", srcB.length === 3 && srcB.includes("kimi-desktop") && srcB.includes("deepseek-harness") && srcB.includes("codex"),
    `bySource=${JSON.stringify(stB.bySource)}`);
  check("工具调用计数正确（Bash + Edit）",
    (stB.tools || []).some((t) => t.name === "Bash") && (stB.tools || []).some((t) => t.name === "Edit"),
    `tools=${JSON.stringify(stB.tools)}`);
  const dbgB = await getDebug();
  const wallB = dbgB.clients?.wall ?? {};
  if (wallB.lights) check("壁纸环带多源点亮（≥3 源）", (wallB.lights || []).length >= 3, `lights=${JSON.stringify(wallB.lights)}`);

  // ---------- C. 综合 ↔ 单一形态切换 ----------
  console.log("\n▶ 阶段 C：综合形态 ↔ 单一 agent 形态切换");
  await api("/view", { method: "POST", body: JSON.stringify({ agent: "kimi-desktop" }) });
  await sleep(800);
  const stC1 = await getState();
  check("切换到单一形态 kimi-desktop", stC1.view === "kimi-desktop", `view=${stC1.view}`);
  await api("/view", { method: "POST", body: JSON.stringify({ agent: "all" }) });
  await sleep(800);
  const stC2 = await getState();
  check("切回综合形态 all", stC2.view === "all", `view=${stC2.view}`);

  // ---------- D. 停止注入 → 动态静默 ----------
  console.log("\n▶ 阶段 D：停止注入，等待动态静默（约 35s）");
  const t0 = Date.now();
  let idleMs = 0;
  while (Date.now() - t0 < 45000) {
    await sleep(3000);
    const st = await getState();
    idleMs = st.idleMs;
    if (idleMs > 33000) break;
  }
  check("停止注入后进入静默（idleMs > 33s）", idleMs > 33000, `idleMs=${Math.round(idleMs / 1000)}s`);
  const dbgD = await getDebug();
  const wallD = dbgD.clients?.wall ?? {};
  if (wallD.lights !== undefined) {
    check("静默后壁纸环带光效熄灭", (wallD.lights || []).length === 0, `lights=${JSON.stringify(wallD.lights)}`);
  } else {
    console.log("  ⤫ 壁纸遥测未上报 lights（可能窗口被遮挡），跳过熄灭断言");
  }
} finally {
  // ---------- 还原真实数据 ----------
  console.log("\n▶ 还原：恢复 /stats 与 /texts，恢复真实连接器，重启壁纸宿主");
  // makeApi 自带 ECONNRESET 重试；还原 POST 是整段替换（幂等），重试安全。
  // 顺序有讲究：先还原（清掉测试污染，回到暂停前状态），再 resume——
  // 暂停期间缓冲的真实事件会在 resume 时回放，叠加在还原后的真实数据之上。
  await api("/stats", { method: "POST", body: JSON.stringify(backup.stats) });
  await api("/texts", { method: "POST", body: JSON.stringify(backup.texts) });
  const resumed = await (await api("/test/resume", { method: "POST" })).json();
  const r = spawnSync("launchctl", ["kickstart", "-k", `gui/${process.getuid()}/com.simwecan.thinking-desktop-wallpaper`], { encoding: "utf8" });
  await sleep(800);
  const after = await (await api("/stats")).json();
  const afterTexts = await (await api("/texts?limit=40")).json();
  // 还原后暂停期间的真实事件被回放，事件数 = 注入前 + 回放数（允许连接器恢复后的少量新增）
  const replayed = resumed?.replayed ?? 0;
  const statsOk = after?.totalEvents != null && backup.stats?.totalEvents != null &&
    after.totalEvents >= backup.stats.totalEvents &&
    after.totalEvents <= backup.stats.totalEvents + replayed + 10;
  check("真实统计已还原（含暂停期间回放的真实事件）", statsOk,
    `今日事件 ${after?.totalEvents ?? "?"}（注入前 ${backup.stats?.totalEvents ?? "?"}，回放 ${replayed} 条）`);
  // 真实连接器会尾随本测试脚本自身的会话日志，其中含有标记字符串的源码原文；
  // 因此残留判定用「注入文本精确全等」而非子串匹配（源码模板带 ${} 未展开，不会误伤）。
  const INJECTED = new Set([
    ...[1, 2, 3].map((i) => `测试注入 · 单 agent 阶段第 ${i} 段思考`),
    ...[1, 2, 3].map((i) => `测试注入 · 并行阶段 deepseek 第 ${i} 段`),
    ...[1, 2, 3].map((i) => `测试注入 · parallel phase codex line ${i}`),
  ]);
  check("文本墙无注入残留", !(afterTexts || []).some((x) => INJECTED.has((x.text || "").trim())),
    `文本墙 ${afterTexts?.length ?? "?"} 条`);
  const stEnd = await (await api("/state")).json();
  check("真实连接器已恢复", stEnd?.testPaused === false);
  check("壁纸宿主已重启", r.status === 0);
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n═══ 隔离注入测试：${pass}/${results.length} 通过 ═══`);
process.exit(pass === results.length ? 0 : 1);
