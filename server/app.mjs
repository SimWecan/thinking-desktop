/**
 * app.mjs — 组合根
 *
 * 分层：hosts → routes/* → core/* → 本文件。依赖只向下——core 不知 HTTP，
 * routes 不互相引用，组装逻辑只在这里发生一次。
 */
import { createServer } from "node:http";
import fs from "node:fs";
import { join } from "node:path";

import { createRouter } from "./core/http.mjs";
import { createSecurity } from "./core/security.mjs";
import { createStore } from "./core/store.mjs";
import { createStreamHub } from "./core/stream-hub.mjs";
import { AgentRegistry } from "./agents.mjs";
import { loadUiConfig } from "./config.mjs";
import { assembleConnectors, detectZstd } from "./connectors.mjs";
import { buildIcons } from "./icons.mjs";

import * as routeStream from "./routes/stream.mjs";
import * as routeDebug from "./routes/debug.mjs";
import * as routeAgents from "./routes/agents.mjs";
import * as routeState from "./routes/state.mjs";
import * as routeIngest from "./routes/ingest.mjs";
import * as routeTexts from "./routes/texts.mjs";
import * as routeStats from "./routes/stats.mjs";
import * as routeTest from "./routes/test.mjs";
import * as routeSnapshot from "./routes/snapshot.mjs";
import * as routeSystem from "./routes/system.mjs";
import * as routeUi from "./routes/ui.mjs";
import * as routeIcons from "./routes/icons.mjs";
import * as routePages from "./routes/pages.mjs";

const ROUTES = [
  routeStream, routeDebug, routeAgents, routeState, routeIngest, routeTexts,
  routeStats, routeTest, routeSnapshot, routeSystem, routeUi, routeIcons,
  routePages,   // 必须最后：静态回退的匹配器恒真，接住所有未被处理的 GET
];

// 日志轮转：launchd 重定向的 stdout/stderr 只增不减；超过 5MB 截断只留末尾 200KB
function rotateLog(root) {
  try {
    const logFile = join(root, "logs", "server.log");
    if (fs.statSync(logFile).size > 5 * 1024 * 1024) {
      fs.writeFileSync(logFile, fs.readFileSync(logFile, "utf8").slice(-200 * 1024));
      console.log("[log] server.log 超过 5MB，已截断保留末尾 200KB");
    }
  } catch { /* 日志文件不存在等情况忽略 */ }
}

// 进程 CPU 占比：process.cpuUsage 差值 / 墙钟时间（/health 展示用）
function makeCpuPercent() {
  let last = process.cpuUsage();
  let lastAt = Date.now();
  return () => {
    const now = process.cpuUsage();
    const nowMs = Date.now();
    const pct = ((now.user + now.system - last.user - last.system) / 1000) / (nowMs - lastAt) * 100;
    last = now; lastAt = nowMs;
    return Math.max(0, Math.round(pct * 10) / 10);
  };
}

export function start({ root, port }) {
  const version = JSON.parse(fs.readFileSync(join(root, "package.json"), "utf8")).version;
  const connectorsOff = process.env.THINKING_DESKTOP_CONNECTORS === "off";

  const security = createSecurity({ root });
  const store = createStore({ root, fs });
  const hub = createStreamHub();
  const agents = new AgentRegistry(root);
  const zstdAvailable = detectZstd();
  const connectors = assembleConnectors({ root, zstdAvailable, connectorsOff, bindings: agents.bindings });

  // UI 配置：GET 读、POST 归一化合并后落盘 config/ui.json，内存态立即生效
  let uiConfig = loadUiConfig(root);
  const ui = {
    get: () => uiConfig,
    set(next) {
      uiConfig = next;
      try {
        fs.mkdirSync(join(root, "config"), { recursive: true });
        fs.writeFileSync(join(root, "config", "ui.json"), JSON.stringify(next, null, 2));
      } catch (err) { console.error("[ui] save failed:", err.message); }
    },
  };

  // 事件出口：store 落库/统计后广播给所有 SSE 客户端
  store.setOnEvent((ev) => hub.broadcast(ev));

  // 演示/测试模式：不载入今日统计——否则刚重启后 restored 来源的 lastEventAt
  // 还热乎（<12s），会被误当成「正在点亮」，污染测试断言
  if (connectorsOff) {
    console.log("[server] THINKING_DESKTOP_CONNECTORS=off：真实连接器全部停用（演示/测试模式）");
  } else {
    store.loadStats();
    for (const c of connectors) {
      c.onEvent = (ev) => store.pushEvent(ev);
      try { c.start(); } catch (err) { console.error(`[${c.source}]`, err.message); }
    }
  }

  const router = createRouter();
  const ctx = {
    root, fs, cookie: security.COOKIE, version,
    store, hub, agents, ui, connectors, zstdAvailable,
    cpuPercent: makeCpuPercent(),
  };
  for (const r of ROUTES) r.register(router, ctx);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const blocked = security.guard(req, res, {
      method: req.method, pathname: url.pathname, searchParams: url.searchParams,
    });
    if (blocked) { blocked(); return; }
    if (!(await router.dispatch(req, res))) {
      res.writeHead(404).end("not found");
    }
  });

  // 退出时尽量落一次盘（launchd 发 SIGTERM）
  process.on("SIGTERM", () => { store.flushOnExit(); hub.close(); process.exit(0); });

  rotateLog(root);
  buildIcons(root, (m) => console.log(m));   // 从已安装 App 提取官方图标（异步，不阻塞服务）

  server.listen(port, "127.0.0.1", () => {
    console.log(`Thinking Desktop → http://127.0.0.1:${port}`);
    console.log(`  /       预览（加 ?debug=1 显示状态面板）`);
    console.log(`  /wall   壁纸地址（Lively / Wallpaper Engine 使用）`);
    console.log(`  /stream SSE 事件流 · /state JSON 状态 · /health 自检`);
    console.log(`已注册 connector: ${connectors.map((c) => `${c.source}(${c.kind})`).join(", ") || "（无）"}`);
    console.log(`zstd: ${zstdAvailable ? "ok" : "缺失（DSH 会话截流不可用）"}`);
  });

  return { server, store, hub, agents };
}
