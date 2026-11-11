/** routes/state.mjs — 全量状态快照（壁纸页轮询 + SSE hello 同款） */
export function register(router, ctx) {
  router.add("GET", "/state", ({ res }) => {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(ctx.store.state({ agents: ctx.agents, ui: ctx.ui.get() })));
  });
}
