/**
 * core/security.mjs — 本机服务的边界：令牌、Host、Origin
 *
 * 服务只监听 127.0.0.1，但浏览器里的任意网页都能向它发请求——
 * 写接口必须带令牌，Host 必须回环（挡 DNS rebinding），Origin 带了就必须是本机。
 */

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// 会改状态的接口（GET 只读除外；/selftest 与带 ?request= 的视为写）
const MUTATING_PATHS = new Set(["/ingest", "/texts", "/view", "/agents", "/snapshot", "/debug", "/selftest", "/restart"]);
const LOCAL_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;
const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;
const MAX_BODY = 12 * 1024 * 1024;   // POST 体上限（canvas 快照 base64 较大，12MB 足够）

export function createSecurity({ root, fs: fsp = { readFileSync, writeFileSync, mkdirSync } }) {
  // 本机令牌：写状态的接口要求带 token（页面用 Cookie 自动携带，脚本读 data/.token）
  const TOKEN_FILE = join(root, "data", ".token");
  let TOKEN = "";
  try { TOKEN = fsp.readFileSync(TOKEN_FILE, "utf8").trim(); } catch { /* 首次启动 */ }
  if (!TOKEN) {
    TOKEN = randomBytes(16).toString("hex");
    try { fsp.mkdirSync(join(root, "data"), { recursive: true }); fsp.writeFileSync(TOKEN_FILE, TOKEN, { mode: 0o600 }); } catch { /* 忽略 */ }
  }

  function tokenOk(req) {
    const h = req.headers["x-td-token"];
    if (h && h === TOKEN) return true;
    const cookie = String(req.headers.cookie || "");
    return cookie.split(/;\s*/).some((kv) => kv === `td_token=${TOKEN}`);
  }

  /** 返回 403 的错误响应，或 null 表示通过（让调用方继续） */
  function guard(req, res, { method, pathname, searchParams }) {
    if (!LOCAL_HOST.test(String(req.headers.host || ""))) {
      return () => res.writeHead(403, { "Content-Type": "text/plain" }).end("forbidden host");
    }
    if (method === "POST" && Number(req.headers["content-length"] || 0) > MAX_BODY) {
      return () => res.writeHead(413).end("payload too large");
    }
    const mutating = MUTATING_PATHS.has(pathname) && (
      method !== "GET" || pathname === "/selftest" || searchParams.has("request")
    );
    if (mutating) {
      const origin = req.headers.origin;
      if (origin && !LOCAL_ORIGIN.test(String(origin))) {
        return () => res.writeHead(403, { "Content-Type": "text/plain" }).end("forbidden origin");
      }
      if (!tokenOk(req)) {
        return () => res.writeHead(403, { "Content-Type": "text/plain" }).end("missing token (见 data/.token，或用页面访问)");
      }
    }
    return null;
  }

  return {
    guard,
    COOKIE: `td_token=${TOKEN}; Path=/; HttpOnly; SameSite=Strict`,
  };
}
