/** routes/ingest.mjs — 事件注入口：本机调试 / 多 agent 并行模拟（只监听回环，不对外） */
import { EVENT_TYPES } from "../../connectors/base.mjs";

export function register(router, ctx) {
  router.add("POST", "/ingest", async ({ res, readJson, query }) => {
    const d = await readJson();
    let ok = false;
    if (d) {
      const type = String(d.type || "text");
      if (EVENT_TYPES.includes(type)) {
        ctx.store.pushEvent({
          source: String(d.source || "sim").slice(0, 40),
          type,
          ts: Date.now(),
          payload: d.payload && typeof d.payload === "object" ? d.payload : {},
          __test: query.has("test"),
        });
        ok = true;
      }
    }
    res.writeHead(ok ? 200 : 400, { "Content-Type": "text/plain" }).end(ok ? "ok" : "bad request");
  });
}
