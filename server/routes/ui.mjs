/** routes/ui.mjs — 界面行为配置：GET 读取，POST 归一化合并后写回 config/ui.json 并立即生效 */
import { normalizeUiConfig } from "../config.mjs";

export function register(router, ctx) {
  router.add("*", "/ui", async ({ method, res, readJson }) => {
    if (method === "POST") {
      const body = await readJson();
      if (body === null) { res.writeHead(400).end("bad request"); return; }
      try {
        ctx.ui.set(normalizeUiConfig({ ...ctx.ui.get(), ...body }));
      } catch { /* 归一化抛错时保留旧值 */ }
    }
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(ctx.ui.get()));
  });
}
