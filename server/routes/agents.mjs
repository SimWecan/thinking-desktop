/**
 * routes/agents.mjs — 绑定客户端：列表 / 新增自定义 / 删除 / 改色 / 改路径 / 改图标，
 * 以及壁纸视图形态切换。
 */
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { collectPresence } from "../agents.mjs";

const ICON_EXT = { "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/jpeg": "jpg" };
const MAX_ICON_BYTES = 3 * 1024 * 1024;

export function register(router, ctx) {
  const { store, agents, hub } = ctx;
  const shotRequested = () => Date.now() - store.flags.shotAt < 3000;

  router.add("POST", "/agents", async ({ res, readJson }) => {
    const m = await readJson();
    if (!m) { res.writeHead(400).end("bad request"); return; }
    // 动作型请求：新增自定义客户端 / 删除
    if (m.action === "create") {
      const source = agents.createCustom({ name: m.name, color: m.color, path: m.path });
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ source, agents: agents.agents(store.sourceStats, Date.now(), collectPresence(ctx.connectors)) }));
      return;
    }
    if (m.action === "remove") {
      agents.removeCustom(m.source);
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ agents: agents.agents(store.sourceStats, Date.now(), collectPresence(ctx.connectors)) }));
      return;
    }
    const list = agents.update(m.source, m, collectPresence(ctx.connectors));
    // 自定义路径当场校验：不存在时给控制台一个明确提示（仍会保存，方便先填后建）
    const pathOk = typeof m.path !== "string" || !m.path.trim() || existsSync(m.path.trim());
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ agents: list, shot: shotRequested(), pathOk }));
  });

  // 自定义图标/动图上传：dataUrl → data/icons/custom/<source>.<ext>
  router.add("POST", "/agents/icon", async ({ res, readJson }) => {
    const m = await readJson();
    if (!m || !m.source || !m.dataUrl) { res.writeHead(400).end("bad request"); return; }
    const mm = String(m.dataUrl).match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
    if (!mm) { res.writeHead(400).end("bad image"); return; }
    const ext = ICON_EXT[mm[1].toLowerCase()];
    if (!ext) { res.writeHead(400).end("unsupported type"); return; }
    const buf = Buffer.from(mm[2], "base64");
    if (!buf.length || buf.length > MAX_ICON_BYTES) { res.writeHead(413).end("too large"); return; }
    const source = String(m.source).replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
    const dir = join(ctx.root, "data", "icons", "custom");
    mkdirSync(dir, { recursive: true });
    // 同一客户端只保留一个图标文件（换格式时清掉旧的）
    for (const old of ["png", "gif", "webp", "jpg"]) {
      try { unlinkSync(join(dir, `${source}.${old}`)); } catch { /* 不存在 */ }
    }
    const file = `${source}.${ext}`;
    writeFileSync(join(dir, file), buf);
    agents.update(source, { iconFile: file });
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ ok: true, iconUrl: `/icon/custom/${file}` }));
  });

  // 目录浏览（控制台选「AI 客户端文件夹」用）：只列目录、限制在本机 home 下
  router.add("GET", "/fs", ({ res, query }) => {
    const home = homedir();
    const raw = String(query.get("path") || home);
    const target = resolve(raw.startsWith("~") ? join(home, raw.slice(1)) : raw);
    if (!target.startsWith(home)) { res.writeHead(403).end("outside home"); return; }
    let dirs = [];
    try {
      dirs = readdirSync(target)
        .filter((n) => !n.startsWith("."))
        .map((n) => ({ name: n, path: join(target, n), dir: (() => { try { return statSync(join(target, n)).isDirectory(); } catch { return false; } })() }))
        .filter((d) => d.dir)
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 200);
    } catch { /* 无权限/不存在 */ }
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ path: target, parent: target === home ? null : dirname(target), dirs }));
  });

  router.add("GET", "/agents", ({ res }) => {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ agents: agents.agents(store.sourceStats, Date.now(), collectPresence(ctx.connectors)), view: agents.view, shot: shotRequested() }));
  });

  // 壁纸视图选择：all = 综合形态；其它 = 单一 agent 形态
  router.add("POST", "/view", async ({ res, readJson }) => {
    const m = await readJson();
    if (!m) { res.writeHead(400).end("bad request"); return; }
    const view = agents.setView(m.agent);
    // 广播给所有 SSE 客户端（壁纸页据此切换形态）
    hub.broadcast({ source: "thinking-desktop", type: "view", ts: Date.now(), payload: { agent: view } });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ view }));
  });
}
