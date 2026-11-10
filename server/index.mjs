#!/usr/bin/env node
/**
 * Thinking Desktop 数据服务
 * 事件汇聚 → 速率统计 → SSE 推送 + JSON API + 壁纸页面
 * 仅使用 Node.js 标准库，零第三方依赖。
 */

import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, normalize, extname, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { FileTailConnector } from "../connectors/file-tail.mjs";
import { SqlitePollConnector } from "../connectors/sqlite-poll.mjs";
import { JsonStorePollConnector } from "../connectors/json-store-poll.mjs";
import { ProcessWatchConnector } from "../connectors/process-watch.mjs";
import { ProcessActivityConnector } from "../connectors/process-activity.mjs";
import { ZstdJsonlPollConnector } from "../connectors/zstd-jsonl-poll.mjs";
import { summarizeDshLine } from "../connectors/dsh-session.mjs";
import { EVENT_TYPES } from "../connectors/base.mjs";
import { KimiWireConnector } from "../connectors/kimi-wire.mjs";

const PORT = Number(process.env.THINKING_DESKTOP_PORT || 7799);
const RATE_WINDOW_MS = 10_000;
import { AgentRegistry } from "./agents.mjs";
import { buildIcons, cachedIconPath, ensureIcon2x } from "./icons.mjs";
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HOME = homedir();
const APP_SUPPORT = join(HOME, "Library", "Application Support");
const agents = new AgentRegistry(ROOT);

// zstd 只在 DSH 会话截流用得到；提前探测，缺了就在启动日志里明确告警
// 轻量自检：内存与最近一段的 CPU 占用（健康检查里给出，便于长时间挂机观察）
let cpuSample = { at: Date.now(), usage: process.cpuUsage() };
function cpuPercent() {
  const now = Date.now();
  const du = process.cpuUsage(cpuSample.usage);
  const dt = Math.max(1, now - cpuSample.at) * 1000;   // µs
  const pct = ((du.user + du.system) / dt) * 100;
  cpuSample = { at: now, usage: process.cpuUsage() };
  return Math.round(pct * 10) / 10;
}

const zstdAvailable = (() => {
  try { return spawnSync("zstd", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

// ---------------------------------------------------------------------------
// 事件汇聚
// ---------------------------------------------------------------------------

const events = [];
const MAX_EVENTS = 500;
const clientDebug = new Map();
let shotAt = 0;
let testClickAt = 0;            // 最近一次「截屏请求」时间
let shotPng = null;
let shotSlot = null;
let shotLights = null;
let shotChart = null;
let shotPanel = null;
let shotTray = null;
let shotRipple = null;
let shotSavedAt = 0;        // 壁纸画布快照（halo canvas.toDataURL 上传，用于无录屏权限时自检）   // client -> 最近一次页面遥测（壁纸宿主与浏览器预览各自一条）
let lastEventAt = 0;
const clients = new Set();
/** @type {Map<string, {events: number, lastEventAt: number, lastType: string}>} */
const sourceStats = new Map();
const secBuckets = new Map();   // 每秒事件数（画速率曲线）
const srcBuckets = new Map();   // source -> Map(sec -> count)：每个 agent 的 60s 曲线
const tokenBySource = new Map(); // source -> 最近一次上下文计量
// 上下文窗口只在会话的 request/context 行里出现；连接器从文件末尾开始读时可能错过它，
// 这里给已知模型一个兜底窗口（DSH 默认 1M），保证占用率能算出来。
const DEFAULT_WINDOW = { "deepseek-harness": 1048576 };
const toolCounts = new Map();   // 工具调用分布
let totalEvents = 0;

// 思考文本落盘：服务重启后 /texts 仍能回填，壁纸开机不会是空环带
const TEXT_FILE = join(ROOT, "data", "texts.json");
let textBacklog = [];
try { const arr = JSON.parse(readFileSync(TEXT_FILE, "utf8")); if (Array.isArray(arr)) textBacklog = arr.slice(-40); } catch {}
let textSaveTimer = 0;

// 今日统计落盘：重启/崩溃后 EVENTS、TOOLS、各来源计数不会归零（跨天自动换文件）
const dayKey = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const statsFile = () => join(ROOT, "data", `stats-${dayKey()}.json`);
let statsSaveTimer = 0;

function saveStats() {
  if (statsSaveTimer) return;
  statsSaveTimer = setTimeout(() => {
    statsSaveTimer = 0;
    try {
      mkdirSync(join(ROOT, "data"), { recursive: true });
      writeFileSync(statsFile(), JSON.stringify({
        date: dayKey(),
        totalEvents,
        tools: Object.fromEntries(toolCounts),
        sources: Object.fromEntries([...sourceStats].map(([k, v]) => [k, { events: v.events, lastEventAt: v.lastEventAt, lastWorkAt: v.lastWorkAt }])),
        tokens: Object.fromEntries(tokenBySource),
      }));
    } catch { /* 落盘失败不影响运行 */ }
  }, 4000);
}

function loadStats() {
  try {
    const d = JSON.parse(readFileSync(statsFile(), "utf8"));
    if (d.date !== dayKey()) return;                    // 跨天：新的一天从 0 开始
    totalEvents = Number(d.totalEvents) || 0;
    for (const [k, v] of Object.entries(d.tools || {})) {
      // 兼容旧格式（直接存数字）与新格式（{name,count}），同名不同大小写合并
      const key = k.toLowerCase();
      const item = v && typeof v === "object"
        ? { name: String(v.name || k), count: Number(v.count) || 0 }
        : { name: k, count: Number(v) || 0 };
      const prev = toolCounts.get(key);
      if (prev) prev.count += item.count;
      else toolCounts.set(key, item);
    }
    for (const [k, v] of Object.entries(d.sources || {})) {
      sourceStats.set(k, { events: Number(v.events) || 0, lastEventAt: Number(v.lastEventAt) || 0, lastType: "restored", lastWorkAt: Number(v.lastWorkAt) || 0 });
    }
    for (const [k, v] of Object.entries(d.tokens || {})) tokenBySource.set(k, v);
    console.log(`[stats] 载入今日统计：${totalEvents} 事件 / ${toolCounts.size} 种工具`);
  } catch { /* 首日或坏文件 */ }
}
function saveTextBacklog() {
  if (textSaveTimer) return;
  textSaveTimer = setTimeout(() => {
    textSaveTimer = 0;
    try {
      mkdirSync(dirname(TEXT_FILE), { recursive: true });
      writeFileSync(TEXT_FILE, JSON.stringify(textBacklog.slice(-40)));
    } catch { /* 落盘失败不影响运行 */ }
  }, 1200);
}

function seriesFrom(buckets, now, seconds = 60) {
  const base = Math.floor(now / 1000);
  const out = [];
  for (let i = seconds - 1; i >= 0; i--) out.push(buckets.get(base - i) || 0);
  return out;
}
function rateSeries(now, seconds = 60) { return seriesFrom(secBuckets, now, seconds); }

function pushEvent(event) {
  console.log(`[event] ${event.source} · ${event.type}`, JSON.stringify(event.payload).slice(0, 120));
  events.push(event);
  if (events.length > MAX_EVENTS) events.shift();
  lastEventAt = event.ts;
  const st = sourceStats.get(event.source) ?? { events: 0, lastEventAt: 0, lastType: "", lastWorkAt: 0 };
  st.events += 1;
  st.lastEventAt = event.ts;
  st.lastType = event.type;
  if (event.type !== "status") st.lastWorkAt = event.ts;   // status 不算工作：用它判断「是否在思考」会误判
  sourceStats.set(event.source, st);
  totalEvents += 1;
  const sec = Math.floor(event.ts / 1000);
  secBuckets.set(sec, (secBuckets.get(sec) || 0) + 1);
  if (secBuckets.size > 240) for (const k of secBuckets.keys()) if (k < sec - 180) secBuckets.delete(k);
  let sb = srcBuckets.get(event.source);
  if (!sb) srcBuckets.set(event.source, (sb = new Map()));
  sb.set(sec, (sb.get(sec) || 0) + 1);
  if (sb.size > 240) for (const k of sb.keys()) if (k < sec - 180) sb.delete(k);
  if (event.type === "tool_call") {
    const raw = String(event.payload?.name || "tool");
    // 同名工具大小写不同（bash / Bash）合并计数，显示首次出现的写法
    const key = raw.toLowerCase();
    const entry = toolCounts.get(key);
    if (entry) entry.count += 1;
    else toolCounts.set(key, { name: raw, count: 1 });
  }
  if (event.type === "text" && event.payload?.text) {
    textBacklog.push({ source: event.source, ts: event.ts, text: event.payload.text, kind: event.payload.kind });
    if (textBacklog.length > 40) textBacklog.shift();
    saveTextBacklog();
  }
  if (event.type === "token") {
    const p = event.payload || {};
    const prev = tokenBySource.get(event.source) || {};
    const window = p.window || prev.window || DEFAULT_WINDOW[event.source] || null;   // 窗口大小只在 request/context 里出现，沿用上一次
    const pct = p.pct != null ? p.pct
      : (window && p.used != null) ? p.used / window
      : (p.maxUsage != null ? p.maxUsage : null);
    tokenBySource.set(event.source, {
      model: p.model ?? prev.model ?? null,
      used: p.used ?? prev.used ?? null,
      window,
      pct: pct == null ? null : Math.max(0, Math.min(1, pct)),
      conversations: p.conversations ?? null,
      at: event.ts,
    });
  }
  saveStats();
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch { clients.delete(res); }
  }
}

function state() {
  const now = Date.now();
  const window = events.filter((e) => now - e.ts < RATE_WINDOW_MS);
  const rate = (window.length / RATE_WINDOW_MS) * 1000; // 事件/秒
  const byType = {};
  for (const e of window) byType[e.type] = (byType[e.type] || 0) + 1;
  const bySource = {};
  for (const e of window) bySource[e.source] = (bySource[e.source] || 0) + 1;
  return {
    now,
    lastEventAt,
    idleMs: now - lastEventAt,
    rate: Math.round(rate * 100) / 100,
    byType,
    bySource,
    shot: Date.now() - shotAt < 3000,   // 3s 内请求过截屏 → 页面回传一帧
    testClick: Date.now() - testClickAt < 3000,   // 自检：让壁纸在环心触发一次冲击波
    // 每个来源最后一次真实事件：用于确认某个 connector 是真的接到数据，而不是只注册成功
    sources: [...sourceStats.entries()].map(([source, s]) => ({
      source,
      events: s.events,
      lastType: s.lastType,
      agoMs: now - s.lastEventAt,
      workAgoMs: s.lastWorkAt ? now - s.lastWorkAt : null,
    })),
    recent: events.slice(-20),
    // 右侧面板用的聚合：速率曲线 / 工具分布 / 上下文计量
    series: rateSeries(now, 60),
    agentSeries: Object.fromEntries([...srcBuckets].map(([src, b]) => [src, seriesFrom(b, now, 60)])),
    tokens: Object.fromEntries(tokenBySource),
    tools: [...toolCounts.values()].sort((a, b) => b.count - a.count).slice(0, 8).map((t) => ({ name: t.name, count: t.count })),
    totalEvents,
    agents: agents.agents(sourceStats, now),
    view: agents.view,
  };
}

// ---------------------------------------------------------------------------
// Connectors —— 按本机实际安装的 AI 软件自动注册
// ---------------------------------------------------------------------------

const connectors = [];
const has = (p) => existsSync(p);

// 1) Codex（OpenAI）：日志库 sqlite 轮询
{
  const p = join(HOME, ".codex", "logs_2.sqlite");
  if (has(p)) {
    connectors.push(new SqlitePollConnector({
      source: "codex",
      path: p,
      table: "logs",
      mapType: (row) => {
        const text = `${row.target} ${row.feedback_log_body}`.toLowerCase();
        if (row.level === "ERROR") return "error";
        if (text.includes("tool")) return "tool_call";
        if (text.includes("turn") || text.includes("response")) return "thought";
        return null; // 心跳/指标类日志忽略，避免空转
      },
      payload: (row) => ({
        level: row.level,
        target: row.target,
        body: String(row.feedback_log_body ?? "").slice(0, 120),
      }),
    }));
  }
}

// 2) Kimi 桌面端：kimi-agent JSON stores 轮询
{
  const dir = join(APP_SUPPORT, "kimi-desktop", "kimi-agent");
  const usage = join(dir, "conversation-context-usage.json");
  if (has(usage)) {
    connectors.push(new JsonStorePollConnector({
      source: "kimi-desktop",
      path: usage,
      contentBased: true,
      summarize: (json) => {
        const items = Object.entries(json);
        const active = items.filter(([, v]) =>
          Date.now() - new Date(v.updatedAt).getTime() < 5 * 60_000);
        if (active.length === 0) return null; // 只是旧会话，不算活动
        return {
          type: "token",
          payload: {
            conversations: active.length,
            maxUsage: Math.max(...active.map(([, v]) => v.contextUsage)),
            model: active[0][1].model,
          },
        };
      },
    }));
  }
  const statuses = join(dir, "conversation-statuses.json");
  if (has(statuses)) {
    let lastRunning = null;
    connectors.push(new JsonStorePollConnector({
      source: "kimi-desktop",
      path: statuses,
      contentBased: true, // 应用定时重写相同内容不算活动
      summarize: (json) => {
        const running = Object.values(json).filter((s) => s === "running").length;
        if (running === lastRunning) return null;
        lastRunning = running;
        return { type: "status", payload: { running, total: Object.keys(json).length } };
      },
    }));
  }
  const edits = join(dir, "file-edit-journal.json");
  if (has(edits)) {
    connectors.push(new JsonStorePollConnector({
      source: "kimi-desktop",
      path: edits,
      summarize: () => ({ type: "thought", payload: { note: "file edit journal updated" } }),
    }));
  }
  // 真实文本截流：尾随本机会话 wire.jsonl（用户消息/助手输出/上下文压缩全落盘）
  const wireDir = join(
    APP_SUPPORT, "kimi-desktop", "daimon-share", "daimon",
    "runtime", "kimi-code", "home", "sessions",
  );
  if (has(wireDir)) {
    connectors.push(new KimiWireConnector({ dir: wireDir }));
  }
}

// 3) DeepSeek Harness：zstd 会话轮询 + 进程守护
{
  const dir = join(HOME, ".dsh", "sessions");
  if (has(dir)) {
    if (!zstdAvailable) {
      // 没装 zstd 时轮询会永远拿不到内容，要吵出来而不是静默空转
      console.warn("[deepseek-harness] 未找到 zstd 命令，DSH 会话截流不可用（brew install zstd）");
    }
    connectors.push(new ZstdJsonlPollConnector({
      source: "deepseek-harness",
      dir,
      // 开源 AI：截流会话文本上墙展示（闭源 AI 无此通道，光环显示预设动画）
      summarize: summarizeDshLine,
    }));
  }
  connectors.push(new ProcessWatchConnector({
    source: "deepseek-harness",
    processName: "DeepSeek Harness",
  }));
}

// 4) Gemini 桌面版：闭源、对话只在服务端 + WKWebView 内存里，没有本地文本
//    进程守护 → 启动/退出；活动度（CPU）→ 真实「正在思考/输出」信号
connectors.push(new ProcessWatchConnector({ source: "gemini-desktop", processName: "Gemini" }));
connectors.push(new ProcessActivityConnector({ source: "gemini-desktop", match: "/Gemini.app/", cpuThreshold: 8 }));

// 5) ChatGPT 桌面版：同上（未启动时活动度自然静默）
connectors.push(new ProcessWatchConnector({ source: "chatgpt-desktop", processName: "ChatGPT" }));
connectors.push(new ProcessActivityConnector({ source: "chatgpt-desktop", match: "/ChatGPT.app/", cpuThreshold: 8 }));

// 6) 开发用：THINKING_DESKTOP_TAIL=<日志文件> 尾随任意日志
if (process.env.THINKING_DESKTOP_TAIL) {
  connectors.push(new FileTailConnector({
    source: "tail",
    path: process.env.THINKING_DESKTOP_TAIL,
    rules: [
      { pattern: /error|Error|ERROR/, type: "error" },
      { pattern: /tool|Tool/, type: "tool_call" },
      { pattern: /.*/, type: "thought" },
    ],
  }));
}

// ---------------------------------------------------------------------------

for (const c of connectors) {
  c.onEvent = pushEvent;
  try { c.start(); } catch (err) { console.error(`[${c.source}]`, err.message); }
}

// ---------------------------------------------------------------------------
// HTTP 服务
// ---------------------------------------------------------------------------

// 壁纸页按需读盘（按 mtime 缓存）：改前端不用重启服务
let wallCache = { at: -1, html: "" };
function wallPage() {
  const file = join(ROOT, "web", "index.html");
  try {
    const st = statSync(file);
    if (st.mtimeMs !== wallCache.at) wallCache = { at: st.mtimeMs, html: readFileSync(file, "utf8") };
  } catch { /* 保留上次内容 */ }
  return wallCache.html;
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === "/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write(`data: ${JSON.stringify({ type: "hello", state: state() })}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (url.pathname === "/debug" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const ua = String(req.headers["user-agent"] ?? "").slice(0, 70);
      try {
        const data = JSON.parse(body);
        const key = String(data.client || ua || "unknown");
        clientDebug.set(key, { ...data, at: Date.now(), ua });
      } catch {}
      res.writeHead(200).end("ok");
    });
    return;
  }
  if (url.pathname === "/debug") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ at: Date.now(), clients: Object.fromEntries(clientDebug) }));
    return;
  }

  // 绑定的 AI 桌面端：列表 / 绑定 / 改色
  if (url.pathname === "/agents") {
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        try {
          const m = JSON.parse(body);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ agents: agents.update(m.source, m), shot: Date.now() - shotAt < 3000 }));
        } catch { res.writeHead(400).end("bad request"); }
      });
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ agents: agents.agents(sourceStats), view: agents.view, shot: Date.now() - shotAt < 3000 }));
    return;
  }

  // 壁纸视图选择：all = 综合形态；其它 = 单一 agent 形态
  if (url.pathname === "/view" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      try {
        const m = JSON.parse(body);
        const view = agents.setView(m.agent);
        // 广播给所有 SSE 客户端（壁纸页据此切换形态）
        const ev = `data: ${JSON.stringify({ source: "thinking-desktop", type: "view", ts: Date.now(), payload: { agent: view } })}\n\n`;
        for (const res2 of clients) { try { res2.write(ev); } catch { clients.delete(res2); } }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ view }));
      } catch { res.writeHead(400).end("bad request"); }
    });
    return;
  }

  if (url.pathname === "/state") {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(state()));
    return;
  }

  // 事件注入口：本机调试 / 多 agent 并行模拟（只监听回环地址，不对外）
  if (url.pathname === "/ingest" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let ok = false;
      try {
        const d = JSON.parse(body);
        const type = String(d.type || "text");
        if (EVENT_TYPES.includes(type)) {
          pushEvent({
            source: String(d.source || "sim").slice(0, 40),
            type,
            ts: Date.now(),
            payload: d.payload && typeof d.payload === "object" ? d.payload : {},
          });
          ok = true;
        }
      } catch { /* 坏包 */ }
      res.writeHead(ok ? 200 : 400, { "Content-Type": "text/plain" }).end(ok ? "ok" : "bad request");
    });
    return;
  }

  // 厂商图标：从本机安装的 .app 里提取的官方商标图（data/icons/*.png）
  if (url.pathname.startsWith("/icon/")) {
    const name = decodeURIComponent(url.pathname.slice("/icon/".length)).replace(/[^a-z0-9@._-]/gi, "");
    if (!name.endsWith(".png")) { res.writeHead(404).end("not found"); return; }
    const source = name.replace(/(@2x)?\.png$/, "");
    let file = cachedIconPath(ROOT, source);
    if (name.includes("@2x")) {
      // 2x 版本按需生成
      ensureIcon2x(ROOT, source, (err, out) => {
        if (err || !out) { res.writeHead(404).end("no icon"); return; }
        res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" }).end(readFileSync(out));
      });
      return;
    }
    if (!existsSync(file)) { res.writeHead(404).end("no icon"); return; }
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" }).end(readFileSync(file));
    return;
  }

  // 回填/清理思考文本：POST 一个数组直接替换服务端缓冲（原子，避免和正在写入的事件抢文件）
  if (url.pathname === "/texts" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      try {
        const arr = JSON.parse(body);
        if (!Array.isArray(arr)) throw new Error("not an array");
        textBacklog = arr
          .filter((e) => e && e.source && typeof e.text === "string")
          .map((e) => ({
            source: String(e.source).slice(0, 40),
            ts: Number(e.ts) || Date.now(),
            text: String(e.text).slice(0, 6000),
            kind: e.kind ? String(e.kind) : undefined,
          }))
          .sort((a, b) => a.ts - b.ts)
          .slice(-40);
        try {
          mkdirSync(dirname(TEXT_FILE), { recursive: true });
          writeFileSync(TEXT_FILE, JSON.stringify(textBacklog));
        } catch { /* 落盘失败不影响内存 */ }
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, count: textBacklog.length }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "text/plain" }).end("bad request");
      }
    });
    return;
  }

  // 最近的思考文本：页面一启动就能把环带/视窗填满，不用等下一次事件
  if (url.pathname === "/texts") {
    const limit = Math.max(1, Math.min(40, Number(url.searchParams.get("limit")) || 12));
    const texts = textBacklog.slice(-limit)
      .map((e) => ({ source: e.source, ts: e.ts, text: e.text ?? "", kind: e.kind }));
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(texts));
    return;
  }

  // 自检：在环心触发一次冲击波
  if (url.pathname === "/selftest" && url.searchParams.has("click")) {
    testClickAt = Date.now();
    res.writeHead(200, { "Content-Type": "text/plain" }).end("click");
    return;
  }

  // 画布快照：GET /snapshot?request=1 请求一帧；GET /snapshot 取 PNG
  if (url.pathname === "/snapshot") {
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        try {
          const data = JSON.parse(body);
          const dec = (v) => {
            const b64 = String(v || "").split(",")[1] || "";
            const buf = Buffer.from(b64, "base64");
            return buf.length > 500 ? buf : null;
          };
          const full = dec(data.png);
          const slot = dec(data.slot);
          const lights = dec(data.lights);
          const chart = dec(data.chart);
          const panelPng = dec(data.panel);
          const trayPng = dec(data.tray);
          const ripplePng = dec(data.ripple);
          if (full) { shotPng = full; shotSavedAt = Date.now(); }   // 让 shot 标记自然过期，托盘也要能看到它
          if (slot) shotSlot = slot;
          if (lights) shotLights = lights;
          if (chart) shotChart = chart;
          if (panelPng) shotPanel = panelPng;
          if (trayPng) shotTray = trayPng;
          if (ripplePng) shotRipple = ripplePng;
        } catch { /* 忽略坏包 */ }
        res.writeHead(200).end("ok");
      });
      return;
    }
    if (url.searchParams.has("request")) {
      shotAt = Date.now();
      res.writeHead(200, { "Content-Type": "text/plain" }).end("requested");
      return;
    }
    if (shotSavedAt && Date.now() - shotSavedAt > 60_000) {
      shotPng = shotSlot = shotLights = shotChart = shotPanel = shotTray = shotRipple = null;
      shotSavedAt = 0;
    }
    const img = url.searchParams.has("slot") ? shotSlot
      : url.searchParams.has("lights") ? shotLights
      : url.searchParams.has("chart") ? shotChart
      : url.searchParams.has("panel") ? shotPanel
      : url.searchParams.has("tray") ? shotTray
      : url.searchParams.has("ripple") ? shotRipple
      : shotPng;
    if (!img) { res.writeHead(404).end("no snapshot"); return; }
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" }).end(img);
    return;
  }

  // 自检：每个 AI 桌面端的连接方式 + 最后一次真实事件（区分「注册了」和「真的接到数据」）
  if (url.pathname === "/health") {
    const sources = state().sources;
    const byName = new Map();
    for (const c of connectors) {
      const e = byName.get(c.source) ?? { source: c.source, kinds: [], events: 0, lastType: null, agoMs: null };
      if (!e.kinds.includes(c.kind)) e.kinds.push(c.kind);
      byName.set(c.source, e);
    }
    for (const s of sources) {
      const e = byName.get(s.source);
      if (e) Object.assign(e, { events: s.events, lastType: s.lastType, agoMs: s.agoMs });
    }
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({
      ok: true,
      uptimeMs: Math.round(process.uptime() * 1000),
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
      cpuPct: cpuPercent(),
      zstd: zstdAvailable,
      connectors: [...byName.values()],
      // 闭源端：最近一次 CPU 采样（用来确认活动度检测真的在跑、阈值是否合适）
      activity: connectors.filter((c) => c.kind === "activity").map((c) => ({
        source: c.source,
        match: c.match,
        threshold: c.cpuThreshold,
        ...c.last,
      })),
    }));
    return;
  }

  // 壁纸与预览：同一页面；?debug=1 显示状态面板
  if (url.pathname === "/" || url.pathname === "/wall") {
    console.log(`[page] ${url.pathname} ${url.search || ""}`.trimEnd());
    // 壁纸宿主是常驻 WKWebView，必须禁缓存，否则改了页面要重装 App 才生效
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
    });
    res.end(wallPage().replace("__DEBUG__", url.searchParams.has("debug") ? "true" : "false"));
    return;
  }

  // 静态资源：web/ 目录（含 /haloflux/ 思考形态页面），限制在 web 根内防目录穿越
  {
    const webRoot = join(ROOT, "web") + sep;
    let fp = normalize(join(webRoot, decodeURIComponent(url.pathname)));
    if (existsSync(fp) && statSync(fp).isDirectory()) fp = join(fp, "index.html");
    if (fp.startsWith(webRoot) && existsSync(fp) && statSync(fp).isFile()) {
      const mime = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".png": "image/png", ".jpg": "image/jpeg", ".mp3": "audio/mpeg",
        ".md": "text/plain; charset=utf-8",
      }[extname(fp).toLowerCase()] ?? "application/octet-stream";
      // 壁纸宿主是常驻 WKWebView：静态资源一律禁缓存，否则改了前端要重装才好
      res.writeHead(200, {
        "Content-Type": mime,
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
      });
      res.end(readFileSync(fp));
      return;
    }
  }

  res.writeHead(404).end("not found");
});

loadStats();
// 退出时尽量落一次盘（launchd 发 SIGTERM）
process.on("SIGTERM", () => { if (statsSaveTimer) clearTimeout(statsSaveTimer); try { writeFileSync(statsFile(), JSON.stringify({ date: dayKey(), totalEvents, tools: Object.fromEntries(toolCounts), sources: Object.fromEntries([...sourceStats].map(([k, v]) => [k, { events: v.events, lastEventAt: v.lastEventAt, lastWorkAt: v.lastWorkAt }])), tokens: Object.fromEntries(tokenBySource) })); } catch {} process.exit(0); });

// 启动时从已安装 App 提取官方图标（异步，不阻塞服务）
buildIcons(ROOT, (m) => console.log(m));

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Thinking Desktop → http://127.0.0.1:${PORT}`);
  console.log(`  /       预览（加 ?debug=1 显示状态面板）`);
  console.log(`  /wall   壁纸地址（Lively / Wallpaper Engine 使用）`);
  console.log(`  /stream SSE 事件流 · /state JSON 状态 · /health 自检`);
  console.log(`已注册 connector: ${connectors.map((c) => `${c.source}(${c.kind})`).join(", ") || "（无）"}`);
  console.log(`zstd: ${zstdAvailable ? "ok" : "缺失（DSH 会话截流不可用）"}`);
});
