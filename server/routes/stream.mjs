/** routes/stream.mjs — SSE 事件流（hello 携带全量 state） */
export function register(router, ctx) {
  router.add("GET", "/stream", ({ req, res }) => {
    ctx.hub.subscribe(req, res, ctx.store.state({ agents: ctx.agents, ui: ctx.ui.get() }));
  });
}
