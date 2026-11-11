/**
 * core/stream-hub.mjs — SSE 客户端集
 *
 * hello（含全量 state）→ 订阅 → broadcast；30s 心跳写注释帧暴露半开死连接。
 * 不构造事件 payload——事件由 store 经 app 注入的广播回调送来。
 */

export function createStreamHub() {
  const clients = new Set();

  // 浏览器崩溃/断网时 TCP 半开连接不触发 close，靠周期写注释帧暴露死连接并清理，
  // 否则 clients 集合只增不减，state() 序列化与推送都白白遍历。
  const heartbeat = setInterval(() => {
    for (const res of clients) {
      try { res.write(": ping\n\n"); } catch { clients.delete(res); }
    }
  }, 30_000);
  heartbeat.unref?.();

  function subscribe(req, res, helloState) {
    // 注意：不要加 Access-Control-Allow-Origin——事件流里有本机 AI 的真实思考文本，
    // 加 * 等于允许任意网页跨域读取。所有正常客户端都与页面同源，无需 CORS。
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ type: "hello", state: helloState })}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
  }

  function broadcast(obj) {
    const payload = `data: ${JSON.stringify(obj)}\n\n`;
    for (const res of clients) {
      try { res.write(payload); } catch { clients.delete(res); }
    }
  }

  function close() { clearInterval(heartbeat); for (const res of clients) try { res.end(); } catch {} }

  return { subscribe, broadcast, close, get size() { return clients.size; } };
}
