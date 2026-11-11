/**
 * scripts/lib/http.mjs — 脚本共用 HTTP 助手（本机回环）
 *
 * 为什么需要重试：服务端 keepAliveTimeout 到点会关闭空闲连接（HTTP 标准行为），
 * Node fetch 的连接池复用半关闭 socket 时偶发 ECONNRESET——请求实际未被处理。
 * 对幂等请求（GET、整段替换式 POST）自动换新连接重试一次即可根治，服务端无需改动。
 */

const NETWORK_ERRORS = new Set(["ECONNRESET", "ECONNREFUSED", "EPIPE", "UND_ERR_SOCKET"]);

const isRetryable = (err) => {
  const code = err?.cause?.code || err?.code || "";
  return NETWORK_ERRORS.has(code) || /socket hang up/i.test(String(err?.message || err));
};

/**
 * 带一次重试的 fetch。opts.retries 可覆盖次数（默认 1）。
 * 只对网络层错误重试；HTTP 4xx/5xx 状态码不抛错，由调用方检查 res.ok。
 */
export async function fetchRetry(url, opts = {}, { retries = 1, delayMs = 400 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetch(url, opts);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || i === retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

/** 读本机令牌（data/.token），拼上后返回统一请求函数 */
export function makeApi({ base, token }) {
  const headers = token ? { "x-td-token": token } : {};
  return (path, opts = {}) =>
    fetchRetry(`${base}${path}`, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
}
