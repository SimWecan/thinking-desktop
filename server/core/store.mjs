/**
 * core/store.mjs — 应用状态的唯一持有者
 *
 * 事件入栈、速率/来源/工具/token 统计、思考文本 backlog、今日统计落盘、
 * 快照缓冲，以及给 /state 与 SSE hello 用的 state() 派生。
 * 本模块不知道 HTTP 存在：事件通过注入的 onEvent 监听器外发（由组合根接 stream-hub）。
 */

const RATE_WINDOW_MS = 10_000;
const MAX_EVENTS = 500;
const TEXTS_MAX = 40;
// 上下文窗口只在会话的 request/context 行里出现；连接器从文件末尾开始读时可能错过它，
// 这里给已知模型一个兜底窗口（DSH 默认 1M），保证占用率能算出来。
const DEFAULT_WINDOW = { "deepseek-harness": 1048576 };

const dayKey = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function seriesFrom(buckets, now, seconds = 60) {
  const base = Math.floor(now / 1000);
  const out = [];
  for (let i = seconds - 1; i >= 0; i--) out.push(buckets.get(base - i) || 0);
  return out;
}

export function createStore({ root, fs: fsp }) {
  const { readFileSync, writeFileSync, mkdirSync } = fsp;

  // ---- 环形缓冲与统计（v1 语义逐行保留） ----
  const events = [];
  const lastQuietAt = new Map();   // 来源 → 最近一条 status/token 的时间（限流用）
  const sourceStats = new Map();
  const secBuckets = new Map();    // 每秒事件数（速率曲线）
  const srcBuckets = new Map();    // source -> Map(sec -> count)：每个 agent 的 60s 曲线
  const tokenBySource = new Map(); // source -> 最近一次上下文计量
  const toolCounts = new Map();    // 工具调用分布（key 小写合并，value 保留首次写法）
  let totalEvents = 0;
  let lastEventAt = 0;

  // ---- 思考文本落盘：服务重启后 /texts 仍能回填 ----
  const TEXT_FILE = `${root}/data/texts.json`;
  let textBacklog = [];
  try { const arr = JSON.parse(readFileSync(TEXT_FILE, "utf8")); if (Array.isArray(arr)) textBacklog = arr.slice(-TEXTS_MAX); } catch {}
  let textSaveTimer = 0;

  // ---- 今日统计落盘（跨天自动换文件） ----
  const statsFile = () => `${root}/data/stats-${dayKey()}.json`;
  let statsSaveTimer = 0;
  let statsDay = dayKey();

  // ---- 自检/测试标志与快照缓冲（routes 经 store.flags / store.shot 访问） ----
  const flags = { shotAt: 0, testClickAt: 0, testPausedAt: 0, testPopupAt: 0 };
  const shot = {
    png: null, slot: null, lights: null, chart: null,
    panel: null, tray: null, ripple: null, savedAt: 0,
  };
  const clientsDebug = new Map();  // client key -> 最近一次页面遥测

  let onEvent = null;              // 组合根注入：接 stream-hub.broadcast

  function rolloverDay() {
    const d = dayKey();
    if (d === statsDay) return;
    statsDay = d;
    totalEvents = 0;
    toolCounts.clear();
    sourceStats.clear();
    tokenBySource.clear();
  }

  function saveStats() {
    rolloverDay();
    if (statsSaveTimer) return;
    statsSaveTimer = setTimeout(() => {
      statsSaveTimer = 0;
      try {
        mkdirSync(`${root}/data`, { recursive: true });
        writeFileSync(statsFile(), JSON.stringify({
          date: dayKey(),
          totalEvents,
          tools: Object.fromEntries(toolCounts),
          sources: Object.fromEntries([...sourceStats].map(([k, v]) => [k, { events: v.events, lastEventAt: v.lastEventAt, lastWorkAt: v.lastWorkAt }])),
          tokens: Object.fromEntries(tokenBySource),
        }));
      } catch { /* 落盘失败不影响运行 */ }
    }, 4000);
  }

  function loadStats() {
    try {
      const d = JSON.parse(readFileSync(statsFile(), "utf8"));
      if (d.date !== dayKey()) return;                    // 跨天：新的一天从 0 开始
      totalEvents = Number(d.totalEvents) || 0;
      for (const [k, v] of Object.entries(d.tools || {})) {
        // 兼容旧格式（直接存数字）与新格式（{name,count}），同名不同大小写合并
        const key = k.toLowerCase();
        const item = v && typeof v === "object"
          ? { name: String(v.name || k), count: Number(v.count) || 0 }
          : { name: k, count: Number(v) || 0 };
        const prev = toolCounts.get(key);
        if (prev) prev.count += item.count;
        else toolCounts.set(key, item);
      }
      for (const [k, v] of Object.entries(d.sources || {})) {
        sourceStats.set(k, { events: Number(v.events) || 0, lastEventAt: Number(v.lastEventAt) || 0, lastType: "restored", lastWorkAt: Number(v.lastWorkAt) || 0 });
      }
      for (const [k, v] of Object.entries(d.tokens || {})) tokenBySource.set(k, v);
      console.log(`[stats] 载入今日统计：${totalEvents} 事件 / ${toolCounts.size} 种工具`);
    } catch { /* 首日或坏文件 */ }
  }

  function saveTextBacklog() {
    if (textSaveTimer) return;
    textSaveTimer = setTimeout(() => {
      textSaveTimer = 0;
      try {
        mkdirSync(`${root}/data`, { recursive: true });
        writeFileSync(TEXT_FILE, JSON.stringify(textBacklog.slice(-TEXTS_MAX)));
      } catch { /* 落盘失败不影响运行 */ }
    }, 1200);
  }

  /** 序列化用：导出今日统计（/stats GET 与 SIGTERM 落盘共用同一形状） */
  function statsSnapshot() {
    return {
      date: dayKey(),
      totalEvents,
      tools: Object.fromEntries(toolCounts),
      sources: Object.fromEntries([...sourceStats].map(([k, v]) => [k, { events: v.events, lastEventAt: v.lastEventAt, lastWorkAt: v.lastWorkAt }])),
      tokens: Object.fromEntries(tokenBySource),
    };
  }

  function pushEvent(event) {
    if (flags.testPausedAt && !event.__test) return;   // 测试隔离：真实 agent 的活动不干扰 e2e
    rolloverDay();
    if (!event.__test && (event.type === "status" || event.type === "token")) {
      const prev = lastQuietAt.get(event.source) || 0;
      if (event.ts - prev < 1000) return;              // 状态类事件 1s 内合并，避免刷屏
      lastQuietAt.set(event.source, event.ts);
    }
    console.log(`[event] ${event.source} · ${event.type}`, JSON.stringify(event.payload).slice(0, 120));
    // 环形缓冲只用于速率/类型统计：丢掉大 payload（文本已单独存 textBacklog），
    // 500 条事件的最坏内存从 ~2MB 降到几十 KB
    events.push(event.type === "text"
      ? { source: event.source, type: event.type, ts: event.ts, payload: { kind: event.payload?.kind } }
      : { source: event.source, type: event.type, ts: event.ts, payload: event.type === "tool_call" ? { name: event.payload?.name } : undefined });
    if (events.length > MAX_EVENTS) events.shift();
    lastEventAt = event.ts;
    const st = sourceStats.get(event.source) ?? { events: 0, lastEventAt: 0, lastType: "", lastWorkAt: 0 };
    st.events += 1;
    st.lastEventAt = event.ts;
    st.lastType = event.type;
    if (event.type !== "status") st.lastWorkAt = event.ts;   // status 不算工作：用它判断「是否在思考」会误判
    sourceStats.set(event.source, st);
    totalEvents += 1;
    const sec = Math.floor(event.ts / 1000);
    secBuckets.set(sec, (secBuckets.get(sec) || 0) + 1);
    if (secBuckets.size > 240) for (const k of secBuckets.keys()) if (k < sec - 180) secBuckets.delete(k);
    let sb = srcBuckets.get(event.source);
    if (!sb) srcBuckets.set(event.source, (sb = new Map()));
    sb.set(sec, (sb.get(sec) || 0) + 1);
    if (sb.size > 240) for (const k of sb.keys()) if (k < sec - 180) sb.delete(k);
    if (event.type === "tool_call") {
      const raw = String(event.payload?.name || "tool");
      const key = raw.toLowerCase();   // bash / Bash 合并计数，显示首次出现的写法
      const entry = toolCounts.get(key);
      if (entry) entry.count += 1;
      else toolCounts.set(key, { name: raw, count: 1 });
    }
    if (event.type === "text" && event.payload?.text) {
      textBacklog.push({ source: event.source, ts: event.ts, text: event.payload.text, kind: event.payload.kind });
      if (textBacklog.length > TEXTS_MAX) textBacklog.shift();
      saveTextBacklog();
    }
    if (event.type === "token") {
      const p = event.payload || {};
      const prev = tokenBySource.get(event.source) || {};
      const window = p.window || prev.window || DEFAULT_WINDOW[event.source] || null;
      const pct = p.pct != null ? p.pct
        : (window && p.used != null) ? p.used / window
        : (p.maxUsage != null ? p.maxUsage : null);
      tokenBySource.set(event.source, {
        model: p.model ?? prev.model ?? null,
        used: p.used ?? prev.used ?? null,
        window,
        pct: pct == null ? null : Math.max(0, Math.min(1, pct)),
        conversations: p.conversations ?? null,
        at: event.ts,
      });
    }
    saveStats();
    onEvent?.(event);
  }

  /** /state 与 SSE hello 的完整快照（deps：agent 注册表与 UI 配置，由调用方注入） */
  function state({ agents, ui }) {
    const now = Date.now();
    const window = events.filter((e) => now - e.ts < RATE_WINDOW_MS);
    const rate = (window.length / RATE_WINDOW_MS) * 1000; // 事件/秒
    const byType = {};
    for (const e of window) byType[e.type] = (byType[e.type] || 0) + 1;
    const bySource = {};
    for (const e of window) bySource[e.source] = (bySource[e.source] || 0) + 1;
    return {
      now,
      lastEventAt,
      idleMs: now - lastEventAt,
      rate: Math.round(rate * 100) / 100,
      byType,
      bySource,
      shot: Date.now() - flags.shotAt < 3000,
      shotFull: Date.now() - (flags.shotFullAt || 0) < 3000,   // 本次快照要全分辨率
      testClick: Date.now() - flags.testClickAt < 3000,
      testPopup: Date.now() - flags.testPopupAt < 6000,
      testPaused: !!flags.testPausedAt,
      sources: [...sourceStats.entries()].map(([source, s]) => ({
        source,
        events: s.events,
        lastType: s.lastType,
        agoMs: now - s.lastEventAt,
        workAgoMs: s.lastWorkAt ? now - s.lastWorkAt : null,
      })),
      series: seriesFrom(secBuckets, now, 60),
      agentSeries: Object.fromEntries([...srcBuckets].map(([src, b]) => [src, seriesFrom(b, now, 60)])),
      tokens: Object.fromEntries(tokenBySource),
      tools: [...toolCounts.values()].sort((a, b) => b.count - a.count).slice(0, 8).map((t) => ({ name: t.name, count: t.count })),
      totalEvents,
      agents: agents.agents(sourceStats, now),
      view: agents.view,
      ui,
    };
  }

  return {
    pushEvent,
    state,
    statsSnapshot,
    loadStats,
    saveStats,
    rolloverDay,
    /** 组合根注入：事件外发通道（接 stream-hub.broadcast） */
    setOnEvent(fn) { onEvent = fn; },
    flushOnExit() {   // SIGTERM：未落盘的统计立刻写一次
      if (statsSaveTimer) clearTimeout(statsSaveTimer);
      try { writeFileSync(statsFile(), JSON.stringify(statsSnapshot())); } catch {}
    },
    flags,
    shot,
    clientsDebug,
    sourceStats,
    toolCounts,
    tokenBySource,
    get textBacklog() { return textBacklog; },
    replaceTexts(arr) {   // /texts POST：原子替换（并立即落盘，避免和事件写入抢文件）
      textBacklog = arr;
      try { mkdirSync(`${root}/data`, { recursive: true }); writeFileSync(TEXT_FILE, JSON.stringify(textBacklog)); } catch {}
    },
    /** /stats POST：按导出快照回填（大小写合并工具名，来源 lastType 置 restored） */
    restoreStats(d) {
      rolloverDay();
      totalEvents = Number(d.totalEvents) || 0;
      toolCounts.clear();
      for (const [k, v] of Object.entries(d.tools || {})) {
        const key = k.toLowerCase();
        const item = v && typeof v === "object"
          ? { name: String(v.name || k), count: Number(v.count) || 0 }
          : { name: k, count: Number(v) || 0 };
        const prev = toolCounts.get(key);
        if (prev) prev.count += item.count;
        else toolCounts.set(key, item);
      }
      sourceStats.clear();
      for (const [k, v] of Object.entries(d.sources || {})) {
        sourceStats.set(k, { events: Number(v.events) || 0, lastEventAt: Number(v.lastEventAt) || 0, lastType: "restored", lastWorkAt: Number(v.lastWorkAt) || 0 });
      }
      tokenBySource.clear();
      for (const [k, v] of Object.entries(d.tokens || {})) tokenBySource.set(k, v);
    },
  };
}
