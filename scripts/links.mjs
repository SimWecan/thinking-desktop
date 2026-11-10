#!/usr/bin/env node
/**
 * 连接自检：把 /health 里的每个 AI 桌面端打印成一张表，
 * 用来确认「connector 注册了」之外，数据通道是不是真的接到了东西。
 *
 *   npm run links                    # 默认 http://127.0.0.1:7799
 *   THINKING_DESKTOP_URL=... npm run links
 */

const BASE = process.env.THINKING_DESKTOP_URL || "http://127.0.0.1:7799";

const ago = (ms) => {
  if (ms == null) return "从未";
  if (ms < 1000) return "刚刚";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s 前`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m 前`;
  return `${Math.round(ms / 3_600_000)}h 前`;
};

const KIND_LABEL = {
  session: "会话文件",
  file: "日志尾随",
  sqlite: "SQLite",
  json: "JSON 状态",
  process: "进程",
  activity: "CPU 活动度",
};

let res;
try {
  res = await fetch(`${BASE}/health`);
} catch (err) {
  console.error(`连不上 ${BASE}：${err.message}\n先启动服务：npm start（或 launchctl kickstart -k gui/$UID/com.simwecan.thinking-desktop）`);
  process.exit(1);
}
const h = await res.json();

console.log(`Thinking Desktop 连接自检  ·  ${BASE}`);
console.log(`服务运行 ${Math.round(h.uptimeMs / 1000)}s · zstd ${h.zstd ? "ok" : "缺失"}\n`);

const act = new Map((h.activity || []).map((a) => [a.source, a]));
const rows = h.connectors.map((c) => {
  const a = act.get(c.source);
  return {
    来源: c.source,
    通道: c.kinds.map((k) => KIND_LABEL[k] || k).join(" + "),
    事件数: c.events ?? 0,
    最后事件: ago(c.agoMs),
    实时活动: a ? `CPU ${a.cpu ?? 0}% / ${a.procs ?? 0} 进程${a.hot ? " · 工作中" : ""}` : "—",
  };
});

const cols = Object.keys(rows[0] ?? {});
const width = (s) => [...String(s)].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
const pad = (s, n) => String(s) + " ".repeat(Math.max(0, n - width(s)));
const widths = cols.map((k) => Math.max(width(k), ...rows.map((r) => width(r[k]))));

console.log(cols.map((k, i) => pad(k, widths[i])).join("  "));
console.log(widths.map((w) => "─".repeat(w)).join("  "));
for (const r of rows) console.log(cols.map((k, i) => pad(r[k], widths[i])).join("  "));

const dead = (h.connectors || []).filter((c) => !c.events || c.agoMs > 24 * 3600_000);
if (dead.length) {
  console.log(`\n提示：${dead.map((c) => c.source).join("、")} 24 小时内没有真实事件——要么对应的 App 今天没干活，要么数据通道需要修。`);
}
