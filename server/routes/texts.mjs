/** routes/texts.mjs — 思考文本墙：最近 N 条回填（GET）/ 原子替换（POST，e2e 备份还原用） */
export function register(router, ctx) {
  const { store } = ctx;

  router.add("GET", "/texts", ({ res, query }) => {
    const limit = Math.max(1, Math.min(40, Number(query.get("limit")) || 12));
    const texts = store.textBacklog.slice(-limit)
      .map((e) => ({ source: e.source, ts: e.ts, text: e.text ?? "", kind: e.kind }));
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(texts));
  });

  router.add("POST", "/texts", async ({ res, readJson }) => {
    const arr = await readJson();
    if (!Array.isArray(arr)) { res.writeHead(400, { "Content-Type": "text/plain" }).end("bad request"); return; }
    store.replaceTexts(
      arr
        .filter((e) => e && e.source && typeof e.text === "string")
        .map((e) => ({
          source: String(e.source).slice(0, 40),
          ts: Number(e.ts) || Date.now(),
          text: String(e.text).slice(0, 6000),
          kind: e.kind ? String(e.kind) : undefined,
        }))
        .sort((a, b) => a.ts - b.ts)
        .slice(-40)
    );
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, count: store.textBacklog.length }));
  });
}
