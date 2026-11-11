/** routes/stats.mjs — 今日统计导出/导入（e2e 测试前后备份还原用） */
export function register(router, ctx) {
  const { store } = ctx;

  router.add("GET", "/stats", ({ res }) => {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(store.statsSnapshot()));
  });

  router.add("POST", "/stats", async ({ res, readJson }) => {
    const d = await readJson();
    if (!d || (d.date && d.date !== store.statsSnapshot().date)) { res.writeHead(400).end("date mismatch"); return; }
    // 直接经 loadStats 的逆操作回填各 Map（与 v1 行为一致：合并而非清零校验）
    const snap = {
      date: d.date,
      totalEvents: Number(d.totalEvents) || 0,
      tools: d.tools || {},
      sources: d.sources || {},
      tokens: d.tokens || {},
    };
    store.restoreStats(snap);
    store.saveStats();
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
  });
}
