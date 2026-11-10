#!/usr/bin/env node
/**
 * Thinking Desktop 数据服务
 * 事件汇聚 → 速率统计 → SSE 推送 + JSON API + 壁纸页面
 * 仅使用 Node.js 标准库，零第三方依赖。
 */

import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
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
import { KimiWireConnector } from "../connectors/kimi-wire.mjs";

const PORT = Number(process.env.THINKING_DESKTOP_PORT || 7799);
const IDLE_AFTER_MS = 4000;
const RATE_WINDOW_MS = 10_000;
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HOME = homedir();
const APP_SUPPORT = join(HOME, "Library", "Application Support");

// zstd 只在 DSH 会话截流用得到；提前探测，缺了就在启动日志里明确告警
const zstdAvailable = (() => {
  try { return spawnSync("zstd", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

// ---------------------------------------------------------------------------
// 事件汇聚
// ---------------------------------------------------------------------------

const events = [];
const MAX_EVENTS = 500;
const clientDebug = new Map();   // client -> 最近一次页面遥测（壁纸宿主与浏览器预览各自一条）
let lastEventAt = 0;
const clients = new Set();
/** @type {Map<string, {events: number, lastEventAt: number, lastType: string}>} */
const sourceStats = new Map();

function pushEvent(event) {
  console.log(`[event] ${event.source} · ${event.type}`, JSON.stringify(event.payload).slice(0, 120));
  events.push(event);
  if (events.length > MAX_EVENTS) events.shift();
  lastEventAt = event.ts;
  const st = sourceStats.get(event.source) ?? { events: 0, lastEventAt: 0, lastType: "" };
  st.events += 1;
  st.lastEventAt = event.ts;
  st.lastType = event.type;
  sourceStats.set(event.source, st);
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
    // 每个来源最后一次真实事件：用于确认某个 connector 是真的接到数据，而不是只注册成功
    sources: [...sourceStats.entries()].map(([source, s]) => ({
      source,
      events: s.events,
      lastType: s.lastType,
      agoMs: now - s.lastEventAt,
    })),
    recent: events.slice(-20),
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

const wallHtml = readFileSync(join(ROOT, "web", "index.html"), "utf8");

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

  if (url.pathname === "/state") {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(state()));
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
    res.end(wallHtml.replace("__DEBUG__", url.searchParams.has("debug") ? "true" : "false"));
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
      res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-cache" });
      res.end(readFileSync(fp));
      return;
    }
  }

  res.writeHead(404).end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Thinking Desktop → http://127.0.0.1:${PORT}`);
  console.log(`  /       预览（加 ?debug=1 显示状态面板）`);
  console.log(`  /wall   壁纸地址（Lively / Wallpaper Engine 使用）`);
  console.log(`  /stream SSE 事件流 · /state JSON 状态 · /health 自检`);
  console.log(`已注册 connector: ${connectors.map((c) => `${c.source}(${c.kind})`).join(", ") || "（无）"}`);
  console.log(`zstd: ${zstdAvailable ? "ok" : "缺失（DSH 会话截流不可用）"}`);
});
