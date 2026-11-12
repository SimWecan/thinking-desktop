/** routes/pages.mjs — 页面与静态资源：壁纸页（mtime 缓存）、页面别名、web/ 静态回退 */
import { join, normalize, sep, extname } from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".mp3": "audio/mpeg",
  ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
};

export function register(router, ctx) {
  const { root, cookie, fs } = ctx;
  const webRoot = join(root, "web");
  const NO_STORE = "no-store, no-cache, must-revalidate";

  // 壁纸页按需读盘（按 mtime 缓存）：改前端不用重启服务
  let wallCache = { at: -1, html: "" };
  const wallPage = () => {
    try {
      const st = fs.statSync(join(root, "web", "index.html"));
      if (st.mtimeMs !== wallCache.at) wallCache = { at: st.mtimeMs, html: fs.readFileSync(join(root, "web", "index.html"), "utf8") };
    } catch { /* 保留上次内容 */ }
    return wallCache.html;
  };

  // 壁纸与预览：同一页面；?debug=1 显示状态面板。壁纸宿主是常驻 WKWebView，
  // 必须禁缓存，否则改了页面要重装 App 才生效
  router.add("GET", (p) => p === "/" || p === "/wall", ({ path, query, res }) => {
    console.log(`[page] ${path} ${query.toString() ? "?" + query.toString() : ""}`.trimEnd());
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": NO_STORE,
      Pragma: "no-cache",
      "Set-Cookie": cookie,
    });
    res.end(wallPage().replace("__DEBUG__", query.has("debug") ? "true" : "false"));
  });

  // 页面别名：/tray、/config、/console（Windows 宿主、README 里用的都是不带 .html 的地址）
  const ALIASES = { "/tray": "tray.html", "/config": "config.html", "/console": "console.html", "/download": "download.html" };
  router.add("GET", (p) => p in ALIASES, ({ path, res }) => {
    try {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": NO_STORE, "Set-Cookie": cookie })
        .end(fs.readFileSync(join(root, "web", ALIASES[path])));
    } catch { res.writeHead(404).end("not found"); }
  });

  // 静态资源：web/ 目录（含 /haloflux/ 思考形态页面），限制在 web 根内防目录穿越。
  // 壁纸宿主是常驻 WKWebView：一律禁缓存，否则改了前端要重装才好。
  // 匹配器恒真——本模块必须最后注册，接住所有未被业务路由处理的 GET。
  router.add("GET", () => true, ({ path, res }) => {
    let fp = normalize(join(webRoot, decodeURIComponent(path)));
    if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) fp = join(fp, "index.html");
    if (fp.startsWith(webRoot + sep) && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      const mime = MIME[extname(fp).toLowerCase()] ?? "application/octet-stream";
      const isLib = path.startsWith("/lib/");
      res.writeHead(200, {
        "Content-Type": mime,
        "Cache-Control": isLib ? "public, max-age=3600" : NO_STORE,
        Pragma: isLib ? "" : "no-cache",
        ...(/text\/html/.test(mime) ? { "Set-Cookie": cookie } : {}),
      });
      res.end(fs.readFileSync(fp));
      return;
    }
    res.writeHead(404).end("not found");
  });
}
