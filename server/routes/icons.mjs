/** routes/icons.mjs — 厂商图标：data/icons/*.png 缓存（从本机 .app 提取）+ web/icon/ 静态回退 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { cachedIconPath, ensureIcon2x } from "../icons.mjs";

export function register(router, ctx) {
  const webIcon = (name) => join(ctx.root, "web", "icon", name);

  // 控制台上传的自定义图标/动图：data/icons/custom/<file>
  router.add("GET", (p) => p.startsWith("/icon/custom/"), ({ path, res }) => {
    const name = decodeURIComponent(path.slice("/icon/custom/".length)).replace(/[^a-z0-9._-]/gi, "");
    const f = join(ctx.root, "data", "icons", "custom", name);
    if (!existsSync(f)) { res.writeHead(404).end("no icon"); return; }
    const ext = (name.split(".").pop() || "png").toLowerCase();
    const mime = ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : ext === "jpg" ? "image/jpeg" : "image/png";
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=60" }).end(readFileSync(f));
  });

  router.add("GET", (p) => p.startsWith("/icon/"), ({ path, res }) => {
    const name = decodeURIComponent(path.slice("/icon/".length)).replace(/[^a-z0-9@._-]/gi, "");

    // 项目自有静态图标（如软件商标 thinking-desktop.svg）直接读 web/icon/
    if (name.endsWith(".svg")) {
      const f = webIcon(name);
      if (!existsSync(f)) { res.writeHead(404).end("no icon"); return; }
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" }).end(readFileSync(f));
      return;
    }
    if (!name.endsWith(".png")) { res.writeHead(404).end("not found"); return; }

    const source = name.replace(/(@2x)?\.png$/, "");
    let file = cachedIconPath(ctx.root, source);
    // 项目自有静态图标（软件商标等）不在厂商图标缓存里，回退读 web/icon/
    if (!existsSync(file)) file = webIcon(name);

    if (name.includes("@2x")) {
      // 2x 版本按需生成
      ensureIcon2x(ctx.root, source, (err, out) => {
        if (err || !out) { res.writeHead(404).end("no icon"); return; }
        res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" }).end(readFileSync(out));
      });
      return;
    }
    if (!existsSync(file)) { res.writeHead(404).end("no icon"); return; }
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" }).end(readFileSync(file));
  });
}
