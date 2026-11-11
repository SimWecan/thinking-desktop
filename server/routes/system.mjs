/** routes/system.mjs — 系统域：重启 / 版本 / 日志 / 健康自检 / AX 读屏 */
import { spawn, execFileSync } from "node:child_process";
import os from "node:os";
import { readFileSync, existsSync, openSync, fstatSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { psStats } from "../../connectors/ps-sample.mjs";
import { collectPresence } from "../agents.mjs";

export function register(router, ctx) {
  const { store, connectors, zstdAvailable, root } = ctx;

  // 重启服务 / 壁纸宿主：由游离子进程延迟 1 秒 kickstart（即便目标是服务自身，
  // launchd KeepAlive + kickstart -k 都能保证拉起来）
  router.add("POST", "/restart", async ({ res, readJson }) => {
    const m = await readJson() || {};
    const target = String(m.target || "both");
    const uid = process.getuid();
    const labels = {
      server: [`gui/${uid}/com.simwecan.thinking-desktop`],
      wallpaper: [`gui/${uid}/com.simwecan.thinking-desktop-wallpaper`],
      both: [`gui/${uid}/com.simwecan.thinking-desktop`, `gui/${uid}/com.simwecan.thinking-desktop-wallpaper`],
    }[target] || [];
    for (const label of labels) {
      const p = spawn("bash", ["-c", `sleep 1; launchctl kickstart -k '${label}'`, "_"], {
        detached: true, stdio: "ignore",
      });
      p.unref();
    }
    console.log(`[restart] 收到重启请求: ${target}（${labels.length} 个服务，1 秒后执行）`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, target, restarting: labels.length }));
  });

  router.add("GET", "/version", ({ res }) => {
    res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
    res.end(ctx.version);
  });

  // 服务日志尾部：控制台窗口的实时日志视图用（只读，随轮换最多保留末尾 200KB）
  router.add("GET", "/logs", ({ res, query }) => {
    const maxLines = Math.min(500, Math.max(20, parseInt(query.get("lines") || "120", 10) || 120));
    try {
      // 只读末尾 200KB：控制台每 2s 拉一次，整文件读（~1MB）纯属浪费
      const file = join(root, "logs", "server.log");
      const fd = openSync(file, "r");
      let text = "";
      try {
        const size = fstatSync(fd).size;
        const start = Math.max(0, size - 200 * 1024);
        const buf = Buffer.alloc(Math.min(size, 200 * 1024));
        readSync(fd, buf, 0, buf.length, start);
        text = buf.toString("utf8");
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        const lines = text.split("\n").filter((l) => l.trim()).slice(-maxLines);
        res.end(JSON.stringify({ ok: true, lines, sizeKb: Math.round(size / 1024) }));
      } finally { closeSync(fd); }
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, lines: [], sizeKb: 0 }));
    }
  });

  // 自检：每个 AI 桌面端的连接方式 + 最后一次真实事件（区分「注册了」和「真的接到数据」）
  router.add("GET", "/health", ({ res }) => {
    const sources = store.state({ agents: ctx.agents, ui: ctx.ui.get(), presence: collectPresence(ctx.connectors) }).sources;
    const byName = new Map();
    for (const c of connectors) {
      const e = byName.get(c.source) ?? { source: c.source, kinds: [], targets: [], events: 0, lastType: null, agoMs: null };
      if (!e.kinds.includes(c.kind)) e.kinds.push(c.kind);
      const target = c.path || c.dir || c.match || c.bundleId || c.processName || null;   // 数据通道落点，配置页展示用
      if (target && !e.targets.includes(target)) e.targets.push(target);
      byName.set(c.source, e);
    }
    for (const s of sources) {
      const e = byName.get(s.source);
      if (e) Object.assign(e, { events: s.events, lastType: s.lastType, agoMs: s.agoMs });
    }
    const w = store.clientsDebug.get("wall") || {};
    const g = w.haloGeom || {};
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      uptimeMs: Math.round(process.uptime() * 1000),
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
      mem: (() => { const m = process.memoryUsage(); return {
        rss: Math.round(m.rss / 1048576),
        heap: Math.round(m.heapUsed / 1048576),
        external: Math.round(m.external / 1048576),
        arrayBuffers: Math.round(m.arrayBuffers / 1048576),
      }; })(),
      cpuPct: ctx.cpuPercent(),
      load: Math.round((os.loadavg()[0] || 0) * 100) / 100,   // 1 分钟负载
      cores: os.cpus().length,
      zstd: zstdAvailable,
      ps: psStats(),   // 进程采样合并效果：spawns 越少越好
      // 渲染侧性能（来自壁纸页遥测）：帧率、每帧渲染耗时、看板渲染耗时
      perf: {
        fps: g.fps ?? null,
        frameMs: g.frameMs ?? null,
        panelMs: w.panelMs ?? null,
        clients: store.clientsDebug.size,
      },
      connectors: [...byName.values()],
      // 闭源端：最近一次 CPU 采样（用来确认活动度检测真的在跑、阈值是否合适）
      activity: connectors.filter((c) => c.kind === "activity").map((c) => ({
        source: c.source,
        match: c.match,
        threshold: c.cpuThreshold,
        ...c.last,
      })),
    }));
  });

  // AX 读屏自检：直接返回 axread 的输出，授权后 `trusted` 会变成 true
  router.add("GET", "/ax", ({ res }) => {
    const bin = join(root, "bin", "axread");
    if (!existsSync(bin)) {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ available: false, hint: "运行 macos/build-axread.sh 编译 bin/axread" }));
      return;
    }
    try {
      const out = execFileSync(bin, ["com.google.GeminiMacOS", "com.openai.codex"], { encoding: "utf8", timeout: 4000 });
      const data = JSON.parse(out.trim() || "{}");
      // 未授权时给控制台一个明确的操作指引（授权按二进制指纹记，重编译会失效）
      data.hostTrusted = !!store.clientsDebug.get("wall")?.axTrusted;   // 壁纸 App 内的 AX 读屏是否已授权
      if (!data.trusted && !data.hostTrusted) {
        data.hint = "在 系统设置 → 隐私与安全性 → 辅助功能 中添加「Thinking Desktop Wallpaper」；授权按二进制指纹记，App 更新后需移除再添加";
      }
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ available: true, error: String(err.message) }));
    }
  });
}
