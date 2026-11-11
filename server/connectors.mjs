/**
 * connectors.mjs — 连接器装配表
 *
 * 按本机实际安装的 AI 软件自动注册连接器（v1 散装在 index.mjs 里的 6 段代码收拢于此）。
 * 每个厂商一个装配函数，新增 AI 桌面端 = 新增一个函数 + 登记进 ASSEMBLERS。
 */

import { join } from "node:path";
import { existsSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

import { SqlitePollConnector } from "../connectors/sqlite-poll.mjs";
import { JsonStorePollConnector } from "../connectors/json-store-poll.mjs";
import { ProcessWatchConnector } from "../connectors/process-watch.mjs";
import { ProcessActivityConnector } from "../connectors/process-activity.mjs";
import { ZstdJsonlPollConnector } from "../connectors/zstd-jsonl-poll.mjs";
import { FileTailConnector } from "../connectors/file-tail.mjs";
import { AxTextConnector } from "../connectors/ax-text.mjs";
import { KimiWireConnector } from "../connectors/kimi-wire.mjs";
import { summarizeDshLine } from "../connectors/dsh-session.mjs";
import { mapCodexLogRow } from "../connectors/codex-filter.mjs";

const HOME = homedir();
const APP_SUPPORT = join(HOME, "Library", "Application Support");
const has = (p) => existsSync(p);

// zstd 只在 DSH 会话截流用得到；提前探测，缺了就在启动日志里明确告警
export function detectZstd() {
  try { return spawnSync("zstd", ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; }
}

function assembleCodex(out, { bindings } = {}) {
  const custom = String(bindings?.codex?.path || "").trim();
  const p = custom || join(HOME, ".codex", "logs_2.sqlite");
  if (!has(p)) return;
  out.push(new SqlitePollConnector({
    source: "codex",
    path: p,
    table: "logs",
    intervalMs: 2000,
    maxBatch: 8,              // 单轮最多 8 条：日志库很吵，宁少勿刷屏
    mapType: mapCodexLogRow,
    payload: (row) => ({
      level: row.level,
      target: row.target,
      body: String(row.feedback_log_body ?? "").slice(0, 120),
    }),
  }));
}

function assembleKimi(out, { bindings } = {}) {
  const custom = String(bindings?.["kimi-desktop"]?.path || "").trim();
  const dir = join(APP_SUPPORT, "kimi-desktop", "kimi-agent");
  const usage = join(dir, "conversation-context-usage.json");
  if (has(usage)) {
    out.push(new JsonStorePollConnector({
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
    out.push(new JsonStorePollConnector({
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
    out.push(new JsonStorePollConnector({
      source: "kimi-desktop",
      path: edits,
      summarize: () => ({ type: "thought", payload: { note: "file edit journal updated" } }),
    }));
  }
  // 真实文本截流：尾随本机会话 wire.jsonl（用户消息/助手输出/上下文压缩全落盘）
  // 控制台里可以填自定义 sessions 目录（例如把 Kimi 装在别的用户目录）
  const wireDir = custom || join(
    APP_SUPPORT, "kimi-desktop", "daimon-share", "daimon",
    "runtime", "kimi-code", "home", "sessions",
  );
  if (has(wireDir)) out.push(new KimiWireConnector({ dir: wireDir }));
}

function assembleDeepSeek(out, { zstdAvailable, bindings } = {}) {
  const custom = String(bindings?.["deepseek-harness"]?.path || "").trim();
  const dir = custom || join(HOME, ".dsh", "sessions");
  if (has(dir)) {
    if (!zstdAvailable) {
      // 没装 zstd 时轮询会永远拿不到内容，要吵出来而不是静默空转
      console.warn("[deepseek-harness] 未找到 zstd 命令，DSH 会话截流不可用（brew install zstd）");
    }
    out.push(new ZstdJsonlPollConnector({
      source: "deepseek-harness",
      dir,
      // 开源 AI：截流会话文本上墙展示（闭源 AI 无此通道，光环显示预设动画）
      summarize: summarizeDshLine,
    }));
  }
  out.push(new ProcessWatchConnector({ source: "deepseek-harness", processName: "DeepSeek Harness" }));
}

// 闭源端：进程守护 → 启动/退出；活动度（CPU）→ 真实「正在思考/输出」信号；AX 读屏（需授权）补真实文本
function assembleGemini(out, { root }) {
  out.push(new ProcessWatchConnector({ source: "gemini-desktop", processName: "Gemini" }));
  out.push(new ProcessActivityConnector({ source: "gemini-desktop", match: "/Gemini.app/", cpuThreshold: 8 }));
  out.push(new AxTextConnector({ source: "gemini-desktop", bundleId: "com.google.GeminiMacOS", bin: join(root, "bin", "axread") }));
}

function assembleChatGPT(out, { root }) {
  out.push(new ProcessWatchConnector({ source: "chatgpt-desktop", processName: "ChatGPT" }));
  out.push(new ProcessActivityConnector({ source: "chatgpt-desktop", match: "/ChatGPT.app/", cpuThreshold: 8 }));
  // ChatGPT.app 的 bundle id 在本机是 com.openai.codex（应用改名/分发方式不同），按实际 bundle id 读
  out.push(new AxTextConnector({ source: "chatgpt-desktop", bundleId: "com.openai.codex", bin: join(root, "bin", "axread") }));
}

// 开发用：THINKING_DESKTOP_TAIL=<日志文件> 尾随任意日志
function assembleDevTail(out) {
  if (!process.env.THINKING_DESKTOP_TAIL) return;
  out.push(new FileTailConnector({
    source: "tail",
    path: process.env.THINKING_DESKTOP_TAIL,
    rules: [
      { pattern: /error|Error|ERROR/, type: "error" },
      { pattern: /tool|Tool/, type: "tool_call" },
      { pattern: /.*/, type: "thought" },
    ],
  }));
}

const ASSEMBLERS = [
  ["codex", assembleCodex],
  ["kimi-desktop", assembleKimi],
  ["deepseek-harness", assembleDeepSeek],
  ["gemini-desktop", assembleGemini],
  ["chatgpt-desktop", assembleChatGPT],
  ["dev-tail", assembleDevTail],
];

/** 装配全部连接器；env.connectorsOff 时返回空表（演示/e2e 隔离用） */
export function assembleConnectors({ root, zstdAvailable, connectorsOff, bindings = {} }) {
  const out = [];
  if (!connectorsOff) {
    for (const [, fn] of ASSEMBLERS) fn(out, { root, zstdAvailable, bindings });
  }
  return out;
}

export { readFileSync, statSync, writeFileSync };   // 路由层共用的 fs 小件从此出，避免各处散 import
