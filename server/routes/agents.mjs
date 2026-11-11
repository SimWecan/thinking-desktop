/** routes/agents.mjs — 绑定的 AI 桌面端（列表/绑定/改色）与壁纸视图形态切换 */
export function register(router, ctx) {
  const { store, agents, hub } = ctx;
  const shotRequested = () => Date.now() - store.flags.shotAt < 3000;

  router.add("POST", "/agents", async ({ res, readJson }) => {
    const m = await readJson();
    if (!m) { res.writeHead(400).end("bad request"); return; }
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ agents: agents.update(m.source, m), shot: shotRequested() }));
  });

  router.add("GET", "/agents", ({ res }) => {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ agents: agents.agents(store.sourceStats), view: agents.view, shot: shotRequested() }));
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
