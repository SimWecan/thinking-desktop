/** routes/test.mjs — 测试隔离与自检开关（e2e 依赖：暂停真实事件 / 触发冲击波 / 弹看板） */
export function register(router, ctx) {
  const { flags } = ctx.store;

  router.add("POST", "/test/pause", ({ res }) => {
    flags.testPausedAt = Date.now();
    res.writeHead(200).end("paused");
  });
  router.add("POST", "/test/resume", ({ res }) => {
    const replayed = ctx.store.pausedCount;
    flags.testPausedAt = 0;
    const n = ctx.store.flushPaused();   // 回放暂停期间缓冲的真实事件
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ resumed: true, replayed: n ?? replayed }));
  });
  router.add("GET", "/selftest", ({ res, query }) => {
    if (query.has("popup")) { flags.testPopupAt = Date.now(); res.writeHead(200, { "Content-Type": "text/plain" }).end("popup"); return; }
    if (query.has("click")) { flags.testClickAt = Date.now(); res.writeHead(200, { "Content-Type": "text/plain" }).end("click"); return; }
    res.writeHead(400).end("unknown selftest");
  });
}
