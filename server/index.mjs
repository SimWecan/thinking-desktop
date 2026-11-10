#!/usr/bin/env node
/**
 * Thinking Desktop 数据服务
 * 事件汇聚 → 速率统计 → SSE 推送 + JSON API + 壁纸页面
 * 仅使用 Node.js 标准库，零第三方依赖。
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FileTailConnector } from "../connectors/file-tail.mjs";

const PORT = Number(process.env.THINKING_DESKTOP_PORT || 7799);
const IDLE_AFTER_MS = 4000;
const RATE_WINDOW_MS = 10_000;
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// ---------------------------------------------------------------------------
// 事件汇聚
// ---------------------------------------------------------------------------

const events = [];
const MAX_EVENTS = 500;
let lastEventAt = 0;
const clients = new Set();

function pushEvent(event) {
  events.push(event);
  if (events.length > MAX_EVENTS) events.shift();
  lastEventAt = event.ts;
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
    recent: events.slice(-20),
  };
}

// ---------------------------------------------------------------------------
// Connectors 注册 —— 在这里接入新的 AI 软件
// ---------------------------------------------------------------------------

const connectors = [];

/** 示例：尾随任意本地日志文件。用 THINKING_DESKTOP_TAIL=file 环境变量启用 */
if (process.env.THINKING_DESKTOP_TAIL) {
  connectors.push(
    new FileTailConnector({
      source: "tail",
      path: process.env.THINKING_DESKTOP_TAIL,
      rules: [
        { pattern: /error|Error|ERROR/, type: "error" },
        { pattern: /tool|Tool/, type: "tool_call" },
        { pattern: /.*/, type: "thought" },
      ],
    })
  );
}

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

  if (url.pathname === "/state") {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(state()));
    return;
  }

  // 壁纸与预览：同一页面；?debug=1 显示状态面板
  if (url.pathname === "/" || url.pathname === "/wall") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(wallHtml.replace("__DEBUG__", url.searchParams.has("debug") ? "true" : "false"));
    return;
  }

  res.writeHead(404).end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Thinking Desktop → http://127.0.0.1:${PORT}`);
  console.log(`  /       预览（加 ?debug=1 显示状态面板）`);
  console.log(`  /wall   壁纸地址（Lively / Wallpaper Engine 使用）`);
  console.log(`  /stream SSE 事件流 · /state JSON 状态`);
  if (connectors.length === 0) {
    console.log("提示：暂无 connector，用 THINKING_DESKTOP_TAIL=<日志文件> 启动可试玩");
  }
});
