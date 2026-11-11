/** routes/debug.mjs — 页面遥测：壁纸宿主/托盘/预览各自上报，/debug 聚合查看 */
export function register(router, ctx) {
  const { store } = ctx;

  router.add("POST", "/debug", async ({ req, res, readJson }) => {
    const ua = String(req.headers["user-agent"] ?? "").slice(0, 70);
    const data = await readJson();
    if (data) {
      const key = String(data.client || ua || "unknown");
      store.clientsDebug.set(key, { ...data, at: Date.now(), ua });
    }
    res.writeHead(200).end("ok");
  });

  router.add("GET", "/debug", ({ res }) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ at: Date.now(), clients: Object.fromEntries(store.clientsDebug) }));
  });
}
