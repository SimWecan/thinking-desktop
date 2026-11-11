/** routes/snapshot.mjs — 画布快照：?request=1 请求一帧，页面回传 PNG，GET 取图 */
export function register(router, ctx) {
  const { store } = ctx;
  const { flags, shot } = store;

  router.add("POST", "/snapshot", async ({ res, readJson }) => {
    const data = await readJson();
    if (data) {
      const dec = (v) => {
        const b64 = String(v || "").split(",")[1] || "";
        const buf = Buffer.from(b64, "base64");
        return buf.length > 500 ? buf : null;
      };
      const full = dec(data.png);
      const slot = dec(data.slot);
      const lights = dec(data.lights);
      const chart = dec(data.chart);
      const panelPng = dec(data.panel);
      const trayPng = dec(data.tray);
      const ripplePng = dec(data.ripple);
      if (full) { shot.png = full; shot.savedAt = Date.now(); }   // 让 shot 标记自然过期，托盘也要能看到它
      if (slot) shot.slot = slot;
      if (lights) shot.lights = lights;
      if (chart) shot.chart = chart;
      // 看板截图只认弹窗页（壁纸页/浏览器预览的看板是隐藏的，会覆盖成空图）
      if (panelPng && String(data.client || "") === "wall-panel") shot.panel = panelPng;
      if (trayPng) shot.tray = trayPng;
      if (ripplePng) shot.ripple = ripplePng;
    }
    res.writeHead(200).end("ok");
  });

  router.add("GET", "/snapshot", ({ res, query }) => {
    if (query.has("request")) {
      flags.shotAt = Date.now();
      res.writeHead(200, { "Content-Type": "text/plain" }).end("requested");
      return;
    }
    if (shot.savedAt && Date.now() - shot.savedAt > 60_000) {
      shot.png = shot.slot = shot.lights = shot.chart = shot.panel = shot.tray = shot.ripple = null;
      shot.savedAt = 0;
    }
    const img = query.has("slot") ? shot.slot
      : query.has("lights") ? shot.lights
      : query.has("chart") ? shot.chart
      : query.has("panel") ? shot.panel
      : query.has("tray") ? shot.tray
      : query.has("ripple") ? shot.ripple
      : shot.png;
    if (!img) { res.writeHead(404).end("no snapshot"); return; }
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" }).end(img);
  });
}
