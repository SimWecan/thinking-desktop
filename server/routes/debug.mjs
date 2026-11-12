/** routes/debug.mjs — 页面遥测：壁纸宿主/托盘/预览各自上报，/debug 聚合查看 */
import { appendFileSync, statSync, renameSync } from "node:fs";
import { join } from "node:path";

const EVENT_LOG_MAX = 256 * 1024;

/**
 * 页面状态翻转（待机↔工作 / 帧链卡死自愈）落一行到 logs/wall-events.log。
 * /debug 的内存遥测只留最后一拍，事后无法判断「停滞」是正常待机还是渲染卡死——
 * 这条日志就是给这种复盘用的，超过 256KB 轮转一份。
 */
function appendEvent(root, data) {
  try {
    const f = join(root, "logs", "wall-events.log");
    try { if (statSync(f).size > EVENT_LOG_MAX) renameSync(f, `${f}.1`); } catch { /* 首次写入 */ }
    const line = `${new Date(data.at || Date.now()).toISOString()} ${data.client || "?"} ${data.event}` +
      (Array.isArray(data.busy) && data.busy.length ? ` busy=${data.busy.join(",")}` : "") +
      (data.calm != null ? ` calm=${data.calm}` : "") +
      (data.idleFor != null ? ` idleFor=${data.idleFor}s` : "") +
      (data.silentMs != null ? ` silentMs=${data.silentMs}` : "") + "\n";
    appendFileSync(f, line);
  } catch { /* 遥测落盘失败不影响服务 */ }
}

export function register(router, ctx) {
  const { store, root } = ctx;

  router.add("POST", "/debug", async ({ req, res, readJson }) => {
    const ua = String(req.headers["user-agent"] ?? "").slice(0, 70);
    const data = await readJson();
    if (data) {
      const key = String(data.client || ua || "unknown");
      store.clientsDebug.set(key, { ...data, at: Date.now(), ua });
      if (data.event) appendEvent(root, data);
    }
    res.writeHead(200).end("ok");
  });

  router.add("GET", "/debug", ({ res }) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ at: Date.now(), clients: Object.fromEntries(store.clientsDebug) }));
  });
}
