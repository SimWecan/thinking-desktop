/**
 * core/http.mjs — 微型路由器
 *
 * 精确路径 + 前缀通配（/icon/*）；handler 收结构化 ctx，不直接摸 req/res 字符串。
 * 不含任何业务路由——业务全部在 server/routes/*。
 */

export function createRouter() {
  const routes = [];   // { method: "GET"|"POST"|"*", match: (path) => bool, handler }

  const add = (method, matcher, handler) => {
    routes.push({
      method,
      match: typeof matcher === "string" ? (p) => p === matcher : matcher,
      handler,
    });
    return add;
  };

  /** 请求入口：返回 true 表示已有路由处理 */
  async function dispatch(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    const ctx = {
      req, res,
      url,
      path: url.pathname,
      method: req.method,
      query: url.searchParams,
      /** 读 JSON 请求体；上限由 security 把关。坏包返回 null（调用方 400） */
      readJson: () => new Promise((resolve) => {
        let body = "";
        req.on("data", (c) => { body += c; });
        req.on("end", () => {
          try { resolve(JSON.parse(body)); } catch { resolve(null); }
        });
        req.on("error", () => resolve(null));
      }),
    };
    for (const r of routes) {
      if (r.method !== "*" && r.method !== req.method) continue;
      if (!r.match(url.pathname)) continue;
      await r.handler(ctx);
      return true;
    }
    return false;
  }

  return { add, dispatch };
}
