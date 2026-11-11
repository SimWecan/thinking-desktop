/* Thinking Desktop bridge — 个人非商业二创
   原作: HALOFLUX by Ryder191 (RYDER CODE / Ms MAIKEBAIs CAT)
   Source: https://github.com/Ryder191/haloflux · PolyForm Noncommercial
   客制化：去面板只留光环 / 静音 / 待机全停 / 真实思考文本上环 / 全局点击冲击波 */
(function () {
  'use strict';

  /* ---------- 关闭自动运镜：去掉无意义的推近/拉远特写，画面保持固定机位 ---------- */
  function tdNoCamera() {
    try {
      C.camera = 0;                    // updateCam 会直接停在 z=1 的中心机位
      cam.x = W / 2; cam.y = H / 2; cam.z = 1;
    } catch (e) {}
  }
  tdNoCamera();
  [0, 400, 1200, 3000, 6000, 12000].forEach((t) => setTimeout(tdNoCamera, t));   // 预设/配置可能晚到，重复压一次

  /* ---------- 待机全停 / 唤起 ---------- */
  window.__wpPaused = true; // Wallpaper Engine 兼容位（与 __tdStandby 同步）
  window.__tdStandby = true; // Thinking Desktop 待机：环带停止转动、环内外粒子消失
  window.__tdStandbyDirty = true;

  // 待机渲染一帧（按需渲染：WKWebView 遮挡时 rAF 被系统节流，必须直接调用）
  function tdRenderStandby() {
    if (!ready) return;
    window.__tdStandbyDirty = false;
    last = performance.now();
    origFrame(last);               // dt=0 → drawStage 内时间冻结
  }
  window.__tdRenderStandby = tdRenderStandby;   // 供 resizeAll 等主脚本场景直接调用

  function tdSetStandby(on) {
    on = !!on;
    if (window.__tdStandby === on) { window.__tdStandbyDirty = true; if (on) tdRenderStandby(); return; }
    window.__tdStandby = on;
    window.__wpPaused = on;
    window.__tdStandbyDirty = true;
    if (on) {
      window.__tdCalm = 1;
      if (window.__tdLightsReset) window.__tdLightsReset();
      // 清残留粒子缓冲：待机首帧就是干净的「停住的环带」
      try { trailC.x.setTransform(1, 0, 0, 1, 0, 0); trailC.x.clearRect(0, 0, trailC.width, trailC.height); } catch (e) {}
      try { comets.length = 0; } catch (e) {}
      tdRenderStandby();
    } else if (!window.__tdRafOn) {
      // 检测到 agent 开始工作：环带恢复转动、粒子特效重启 rAF 循环
      window.__tdRafOn = true;
      last = performance.now();
      requestAnimationFrame(frame);
    }
  }

  // 动态静默：0 = 全速；0→1 之间环带逐渐减速、粒子渐暗；≥1 完全静默（standby 冻结）。
  // 页面在静默过渡窗口内每秒推送当前 calm 值；活动回归时先收到 0 再恢复全速。
  function tdSetCalm(v) {
    v = Math.max(0, Math.min(1, Number(v) || 0));
    if (v >= 1) { window.__tdCalm = 1; tdSetStandby(true); return; }
    window.__tdCalm = v;
    if (window.__tdStandby) tdSetStandby(false);
  }
  window.__tdSetCalm = tdSetCalm;

  // 待机帧周期性自检刷新（捕获窗口尺寸变化 / 新截流文本；rAF 挂起时也要能自刷）
  setInterval(() => { if (window.__tdStandby) { window.__tdStandbyDirty = true; tdRenderStandby(); } }, 3000);

  window.addEventListener('message', (ev) => {
    let m;
    try { m = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data; } catch (e) { return; }
    if (!m || m.td === undefined) return;
    if (m.td === 'pause') { tdSetStandby(!!m.value); return; }   // Wallpaper Engine 兼容：语义同 standby
    if (m.td === 'standby') { tdSetStandby(!!m.value); return; }
    if (m.td === 'calm') { tdSetCalm(m.value); return; }   // 动态静默 0→1（页面在静默过渡窗口推送）
    if (m.td === 'set') { try { setParam(m.key, m.value, true); } catch (e) {} return; }
    if (m.td === 'preset') { try { loadPreset(m.name, null); } catch (e) {} return; }
    if (m.td === 'mouse') { if (window.__tdMouse) window.__tdMouse(m.x, m.y); return; }
    if (m.td === 'click') { if (window.__tdClick) window.__tdClick(m.x, m.y); return; }
    if (m.td === 'sources') { if (window.__tdSources) window.__tdSources(m.list); return; }
    if (m.td === 'ring') { try { window.__tdSetRing(m.ring || m); } catch (e) {} return; }   // 控制台调整圆环位置/大小
    if (m.td === 'text') { // 思考日志 → 环带数据块 + 悬停视窗
      const s = String(m.text || '').replace(/\s+/g, ' ').trim();
      if (s.length < 4) return;
      const last = window.__tdText[window.__tdText.length - 1];
      if (m.replace && last !== undefined) {                    // 同一条流式文本越写越长 → 原地替换
        if (m.id) window.__tdTextId = m.id;
        if (s.length >= last.length) window.__tdText[window.__tdText.length - 1] = s.slice(0, 220);
      } else {
        if (m.id && m.id <= (window.__tdTextId || 0)) return;   // 重复投递（ready 重发）丢弃
        if (m.id) window.__tdTextId = m.id;
        if (s === last) return;                                 // 连续完全重复不叠
        window.__tdText.push(s.slice(0, 220));
        if (window.__tdText.length > 80) window.__tdText.shift();
      }
      window.__tdTextDirty = true;
      window.__tdTextVersion++;
      if (window.__tdStandby) tdRenderStandby();
    }
  }, false);

  // 运行时错误回传主页面（壁纸里看不到控制台，出问题要能被 /debug 看见）
  window.addEventListener('error', (e) => {
    try { parent.postMessage({ td: 'error', message: String((e && e.message) || 'unknown'), at: Date.now() }, '*'); } catch (err) {}
  });

  // 加载完成后通知主页面同步状态（解决启动早期消息丢失）
  window.addEventListener('load', () => { try { parent.postMessage({ td: 'ready' }, '*'); } catch (e) {} });
  setTimeout(() => { try { parent.postMessage({ td: 'ready' }, '*'); } catch (e) {} }, 600);

  /* ---------- 思考文本截流上墙（开源 AI；闭源 AI 无文本 → 预设动画） ---------- */
  window.__tdText = [];
  window.__tdTextDirty = false;
  // 环上数据块用真实截流文本填充（闭源 AI 没有文本时才退回预设动画）
  window.__tdRingText = true;
  window.__tdTextVersion = 0;   // 每次收到新文本 +1，环槽据此判断要不要重画
  const _code = BLOCKS.code, _para = BLOCKS.para;

  /** 最近的思考文本拼成一条「环带纸带」：最新在前，各环槽按角度取不同片段 */
  function tdStream() {
    if (window.__tdStreamVer !== window.__tdTextVersion || !window.__tdStreamCache) {
      window.__tdStreamVer = window.__tdTextVersion;
      const src = window.__tdText.slice(-24).reverse();
      const keep = [];
      for (const t of src) {
        if (!keep.length) { keep.push(t); continue; }
        const prev = keep[keep.length - 1];
        if (t === prev || prev.startsWith(t)) continue;   // 流式前缀：只留更长的那条
        keep.push(t);
      }
      window.__tdStreamCache = keep.join("  ·  ").replace(/\s+/g, " ");
    }
    return window.__tdStreamCache;
  }

  /** 每个环槽一个稳定但互不相同的起点：整圈环带像一组「数据块」，而不是同一段话刷满 */
  function tdSlotStart(a) {
    const h = Math.sin(a * 12.9898 + 78.233) * 43758.5453;
    return h - Math.floor(h);
  }

  function tdSlice(str, start, n) {
    if (str.length <= n) return str;
    const head = str.slice(start, start + n);
    return head.length === n ? head : head + str.slice(0, n - head.length);
  }

  /** 按角度把纸带切成连续片段写进环槽：同一圈环带上每块内容都不一样 */
  function tdFillSlot(c, x0, x1, y0, y1, t, startFrac) {
    const size = 6.4, lh = 8.2;
    c.font = `500 ${size}px ${FONT}`;
    const maxChars = Math.max(6, ((x1 - x0 - 2) / (size * 0.6)) | 0);
    const stream = tdStream();
    if (!stream.length) return;
    let cursor = Math.floor(stream.length * Math.min(0.999, Math.max(0, startFrac)));
    let y = y0;
    while (y < y1 - lh * 0.65) {
      c.fillStyle = rgba(t, 0.92);
      c.fillText(tdSlice(stream, cursor, maxChars), x0 + 0.5, y);
      cursor = (cursor + maxChars) % stream.length;
      y += lh;
    }
  }

  /* ---------- 环带文本布局稳定：每个环槽的版式只随机一次，之后只换字 ---------- */
  function tdSlotPlain(s, band, h) {
    // 版式底图：索引列 + 底部刻度（原本每次重绘都会重掷随机数 → 环带「沸腾」）
    const c = document.createElement('canvas');
    c.width = Math.ceil(band * RING_SC); c.height = Math.ceil((h + 2) * RING_SC);
    const x = c.getContext('2d'); x.scale(RING_SC, RING_SC); x.textBaseline = 'top';
    const RB = rimW(), dz0 = RB + 6, oz0 = band * 0.78, oz1 = band - RB - 5;
    const pitch = rr(8, 12);
    x.font = `600 3.1px ${FONT}`;
    for (let yy = rr(1, pitch); yy < h - 2; yy += pitch) {
      if (rnd() < 0.15) continue;
      let xx = oz0 + rr(0, 3);
      if (rnd() < 0.45) { x.fillStyle = `rgba(225,228,236,${rr(0.55, 0.95)})`; x.fillText(String((rnd() * 999) | 0).padStart(3, '0'), xx, yy - 1); xx += 9; }
      const n = 1 + (rnd() * 3 | 0);
      for (let i = 0; i < n && xx < oz1; i++) { x.fillStyle = `rgba(225,228,236,${rr(0.5, 0.95)})`; x.fillRect(xx, yy, rr(1.2, 2.4), 1.2); xx += rr(2.4, 3.6); }
    }
    if (rnd() < 0.45) {
      x.fillStyle = 'rgba(220,224,232,.7)';
      for (let xx = dz0; xx < oz1; xx += rr(2.4, 4.5)) if (rnd() < 0.8) x.fillRect(xx, h + 0.4, 1.1, 1.1);
    }
    return c;
  }

  const _renderSlot = renderSlot;
  renderSlot = function (s) {
    if (!window.__tdRingText || !window.__tdText.length) return _renderSlot(s);   // 预设动画
    if (s.c && s.ver === window.__tdTextVersion) return;                          // 没新文本 → 不白画
    const band = RO - R, h = s.hpx;
    if (!s.rects) {
      const RB = rimW(), dz0 = RB + 6, dz1 = band * 0.72;
      const split = rnd() < 0.45 && dz1 - dz0 > 60;
      const blocks = [];
      if (split) { const m = dz0 + (dz1 - dz0) * rr(0.42, 0.6); blocks.push([dz0, m], [m + rr(4, 8), dz1]); }
      else blocks.push([dz0, dz1 - rr(0, 18)]);
      s.rects = blocks.map(([b0, b1]) => [b0, b1, 1 + rr(0, 2), h + 1 - rr(0, 2), pick(TINTS)]);
      s.plain = tdSlotPlain(s, band, h);
    }
    const c = document.createElement('canvas');
    c.width = s.plain.width; c.height = s.plain.height;
    const x = c.getContext('2d');
    x.drawImage(s.plain, 0, 0);
    x.scale(RING_SC, RING_SC); x.textBaseline = 'top';
    for (const [b0, b1, y0, y1, tint] of s.rects) {
      x.save(); x.beginPath(); x.rect(b0, y0 - 0.5, b1 - b0, y1 - y0 + 1); x.clip();
      const y = header(x, b0, b1, y0, tint);
      tdFillSlot(x, b0, b1, y, y1, tint, tdSlotStart(s.a));
      x.restore();
    }
    window.__tdTextPaints++;
    s.ver = window.__tdTextVersion;
    window.__tdDebugSlot = c;
    s.c = c;
  };

  // 新文本到达 → 重绘全部环槽（节流：环槽几何带随机量，刷太快会「沸腾」）
  let lastSlotRebuild = 0;
  (function flushLoop() {
    if (window.__tdTextDirty && !window.__wpPaused && Date.now() - lastSlotRebuild > 300) {
      window.__tdTextDirty = false;
      lastSlotRebuild = Date.now();
      try { slots.forEach((s) => { s.c = null; }); } catch (e) {}
    }
    requestAnimationFrame(flushLoop);
  })();

  /* ---------- 悬停环带：只用来触发右侧截流视窗，不做任何特写/放大 ---------- */
  function tdOverRing(x, y) {
    const c0 = toScreen(cx, cy);
    const d = Math.hypot(x - c0.x, y - c0.y);
    const ri = R * cam.z, ro = RO * cam.z;
    return d >= ri - 12 && d <= ro + 12;
  }
  window.__tdHoverRing = false;
  window.__tdTextPaints = 0;   // 自检：环带文本实际重绘次数
  window.__tdHaloBuild = "halo-6";
  // 自检用几何：确认环心/半径与命中判定一致（父页面会把它带进 /debug 遥测）
  window.__tdGeomGet = () => ({
    cx: Math.round(cx), cy: Math.round(cy), R: Math.round(R), RO: Math.round(RO),
    camZ: +cam.z.toFixed(2), W: Math.round(W), H: Math.round(H), hover: !!window.__tdHoverRing,
    paints: window.__tdTextPaints,
    adaptCap: ADAPT_CAP,   // 自适应分辨率当前档位（掉帧时 2→1.5→1.25→1）
    dpr: DPR,
    fps: window.__tdLastFps || null,   // 最近 4s 采样窗实际帧率（卡顿排查遥测）
    textLens: (window.__tdText || []).slice(-4).map((t) => t.length),
    frameMs: Math.round((window.__tdFrameMs || 0) * 100) / 100,
    lights: (() => { try { return window.__tdLightState ? window.__tdLightState() : null; } catch (e) { return null; } })(),
  });
  window.__tdMouse = function (x, y) {
    hoverSeenAt = Date.now();
    const over = tdOverRing(x, y);
    if (over === hoverInRing) return;
    hoverInRing = over;
    window.__tdHoverRing = over;
    try { parent.postMessage({ td: 'hover', ring: over }, '*'); } catch (e) {}
  };
  // 鼠标移出窗口后不会再收到 mouse 事件，600ms 无更新即视为离开环带
  setInterval(() => {
    if (hoverInRing && Date.now() - hoverSeenAt > 600) {
      hoverInRing = false;
      window.__tdHoverRing = false;
      try { parent.postMessage({ td: 'hover', ring: false }, '*'); } catch (e) {}
    }
  }, 250);


  // 自检截图统一缩到一半：1920×1080 的 PNG 单张 ~3.5MB，存服务端内存 + toDataURL 编码都贵；
  // 半分辨率（960×540）对肉眼校验足够，体积和编码耗时都降到 1/4 左右。
  let SHOT_SCALE = 0.5;
  // 自检/宣传图需要全分辨率时，页面可临时切换到 1.0
  window.__tdSetShotScale = (v) => { SHOT_SCALE = Math.max(0.25, Math.min(1, Number(v) || 0.5)); };
  function shotCanvas(w, h, paint) {
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(w * SHOT_SCALE));
    out.height = Math.max(1, Math.round(h * SHOT_SCALE));
    const x = out.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    paint(x, out.width, out.height);
    return out;
  }
  // 自检：导出主画布（环带/粒子都在上面），用于在没有录屏权限的机器上验证画面
  window.__tdSnapshot = function () {
    try {
      const stageEl = document.getElementById('stage');
      const out = shotCanvas(stageEl.width, stageEl.height, (x, w, h) => {
        x.drawImage(stageEl, 0, 0, w, h);
        for (const id of ['td-lights', 'td-ripple']) {
          const el = document.getElementById(id);
          if (el) x.drawImage(el, 0, 0, w, h);
        }
      });
      return out.toDataURL('image/png');
    } catch (e) { return null; }
  };
  window.__tdLightsShot = function () {
    try {
      const el = document.getElementById('td-lights');
      if (!el) return null;
      const out = shotCanvas(el.width, el.height, (x, w, h) => x.drawImage(el, 0, 0, w, h));
      return out.toDataURL('image/png');
    } catch (e) { return null; }
  };
  // 自检：最近一个「文本环槽」的独立画布，用来确认环带里画的到底是文字还是预设图案
  window.__tdDebugSlot = null;
  window.__tdSlotShot = function () {
    try {
      const c = window.__tdDebugSlot;
      if (!c) return null;
      return shotCanvas(c.width, c.height, (x, w, h) => x.drawImage(c, 0, 0, w, h)).toDataURL('image/png');
    } catch (e) { return null; }
  };

  /* ---------- 多厂商光效：谁在跑，就用谁的颜色点亮环带内外 ---------- */
  (function initSourceLights() {
    const cv = document.createElement('canvas');
    cv.id = 'td-lights';
    cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:7';
    document.body.appendChild(cv);
    const g = cv.getContext('2d');
    let dpr = 1;
    const fit = () => {
      dpr = dprCap();
      cv.width = Math.round(innerWidth * dpr);
      cv.height = Math.round(innerHeight * dpr);
    };
    fit();
    addEventListener('resize', fit);

    const toRgb = (hex) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
      if (!m) return [154, 164, 178];
      const n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const ORDER = { 'kimi-desktop': 0, 'deepseek-harness': 1, codex: 2, 'gemini-desktop': 3, 'chatgpt-desktop': 4 };
    const orderOf = (src) => (ORDER[src] ?? 9);

    let lights = [], raf = 0, lastMsg = 0, frames = 0, draws = 0, lastErr = '';
    let lastStepAt = 0;

    window.__tdLightState = () => ({
      count: lights.filter((l) => l.cur > 0.02).length,
      srcs: lights.filter((l) => l.cur > 0.02).map((l) => l.src),
      cur: lights.map((l) => [l.src, +l.cur.toFixed(2), +l.lane.toFixed(2)]),
      frames, draws, lastErr, size: [cv.width, cv.height],
    });
    window.__tdLightsNow = () => lights.filter((l) => l.cur > 0.01).map((l) => ({ rgb: l.rgb, cur: l.cur }));
    // 进入待机：rAF 会停，光效层必须清空，不然半透明的光斑会冻在冻结帧上
    window.__tdLightsReset = function () {
      lights = [];
      if (raf) { try { cancelAnimationFrame(raf); } catch (e) {} raf = 0; }
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cv.width, cv.height);
      lastStepAt = 0;
    };

    // 新来源从 0 淡入；消失的来源留在数组里淡出，cur 归零才移除
    window.__tdSources = function (list) {
      lastMsg = Date.now();
      const arr = (Array.isArray(list) ? list : []).slice().sort((a, b) => orderOf(a.src) - orderOf(b.src));
      const seen = new Set(arr.map((x) => x.src));
      for (const L of lights) if (!seen.has(L.src)) L.target = 0;
      for (const x of arr) {
        let L = lights.find((l) => l.src === x.src);
        if (!L) {
          L = {
            src: x.src, rgb: toRgb(x.color), cur: 0, target: 0,
            lane: 0.5, laneTarget: 0.5,
            dots: Array.from({ length: 36 }, () => ({
              a: Math.random() * TAU,
              r: Math.random(),
              s: (Math.random() - 0.5) * 0.5,
              ph: Math.random() * TAU,
              sz: 0.9 + Math.random() * 1.8,
            })),
          };
          lights.push(L);
        }
        L.rgb = toRgb(x.color);
        L.target = Math.max(0.05, Math.min(1, Number(x.intensity) || 0.5));
      }
      // 通道位置随「在场数」平滑重排（1 个居中，2 个 1/3、2/3…）
      const active = lights.filter((l) => l.target > 0).sort((a, b) => orderOf(a.src) - orderOf(b.src));
      active.forEach((L, i) => { L.laneTarget = (i + 0.5) / active.length; });
      if (!raf) raf = requestAnimationFrame(step);
    };

    function step(now) {
      raf = 0;
      frames++;
      // 光效是慢变化，30fps 足够：省一半绘制，视觉上看不出来
      if (lastStepAt && now - lastStepAt < 30) { raf = requestAnimationFrame(step); return; }
      const dt = Math.min(0.05, lastStepAt ? (now - lastStepAt) / 1000 : 0.016);
      lastStepAt = now;
      if (Date.now() - lastMsg > 3000) for (const L of lights) L.target = 0;

      // 指数平滑：亮度淡入淡出、通道位置滑动，切换时不硬跳
      const kl = Math.min(1, dt * 2.6);
      for (const L of lights) {
        const rising = L.target > L.cur;
        const k = Math.min(1, dt * (rising ? 5 : 1.8));   // 亮起快、暗下去慢
        L.cur += (L.target - L.cur) * k;
        L.lane += (L.laneTarget - L.lane) * kl;
      }
      lights = lights.filter((L) => L.target > 0 || L.cur > 0.02);

      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cv.width, cv.height);
      if (!lights.length) { lastStepAt = 0; return; }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.globalCompositeOperation = 'lighter';

      const c0 = toScreen(cx, cy);
      const z = cam.z, band = (RO - R) * z, n = lights.length;
      for (let i = 0; i < n; i++) {
        const L = lights[i];
        if (L.cur < 0.01) continue;
        const rad = (R + (RO - R) * L.lane) * z;
        const w = Math.max(10, band * (n === 1 ? 0.55 : 0.52 / n));
        const a = L.cur * (0.55 + 0.45 * Math.sin(now / 1100 + i * 1.7));
        const [r, gg, b] = L.rgb;
        const grd = g.createRadialGradient(c0.x, c0.y, Math.max(1, rad - w), c0.x, c0.y, rad + w);
        grd.addColorStop(0, `rgba(${r},${gg},${b},0)`);
        grd.addColorStop(0.35, `rgba(${r},${gg},${b},${(0.78 * a).toFixed(3)})`);
        grd.addColorStop(0.6, `rgba(${r},${gg},${b},${(0.46 * a).toFixed(3)})`);
        grd.addColorStop(1, `rgba(${r},${gg},${b},0)`);
        g.fillStyle = grd;
        g.beginPath();
        g.arc(c0.x, c0.y, rad + w, 0, TAU);
        g.arc(c0.x, c0.y, Math.max(1, rad - w), 0, TAU, true);
        g.fill('evenodd');
        g.beginPath();
        g.arc(c0.x, c0.y, rad, 0, TAU);
        g.strokeStyle = `rgba(${r},${gg},${b},${(0.85 * a).toFixed(3)})`;
        g.lineWidth = n > 1 ? 1.4 : 2.2;
        g.stroke();
        draws++;

        for (const d of L.dots) {
          d.a += d.s * dt;
          const rr = rad + (d.r - 0.5) * band * 1.35;
          const x = c0.x + Math.cos(d.a) * rr, y = c0.y + Math.sin(d.a) * rr;
          const al = L.cur * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now / 420 + d.ph)));
          g.fillStyle = `rgba(${r},${gg},${b},${(1 * al).toFixed(3)})`;
          g.beginPath(); g.arc(x, y, d.sz, 0, TAU); g.fill();
          g.fillStyle = `rgba(${r},${gg},${b},${(0.34 * al).toFixed(3)})`;
          g.beginPath(); g.arc(x, y, d.sz * 4.5, 0, TAU); g.fill();
        }
      }
      raf = requestAnimationFrame(step);
    }
  })();

  /* ---------- 厂商配色：整帧按主色染色（粒子/光束/环带一起），颜色平滑过渡 ---------- */
  const _drawStage = drawStage;
  window.__tdTint = { r: 255, g: 255, b: 255, a: 0 };
  drawStage = function (dt) {
    _drawStage(dt);
    let tints = [];
    try { tints = window.__tdLightsNow ? window.__tdLightsNow() : []; } catch (e) { tints = []; }
    const cur = window.__tdTint;
    let tr = cur.r, tg = cur.g, tb = cur.b, ta = 0;
    if (tints.length) {
      // 主色：强度 × 饱和度最高者（白色不抢镜），多厂商时不会混成一团灰
      let best = tints[0], bestScore = -1;
      for (const t of tints) {
        const mx = Math.max(1, ...t.rgb), mn = Math.min(...t.rgb);
        const score = Math.max(0.05, t.cur) * (1 + ((mx - mn) / mx) * 2.5);
        if (score > bestScore) { bestScore = score; best = t; }
      }
      tr = best.rgb[0]; tg = best.rgb[1]; tb = best.rgb[2];
      ta = Math.min(0.9, 0.6 + 0.3 * Math.min(1, best.cur));
    }
    const k = 0.06;   // 每帧向目标靠拢 → 约 0.5s 换完一次色
    cur.r += (tr - cur.r) * k;
    cur.g += (tg - cur.g) * k;
    cur.b += (tb - cur.b) * k;
    cur.a += (ta - cur.a) * k;
    if (cur.a < 0.01) return;
    const r = Math.round(cur.r), gg = Math.round(cur.g), b = Math.round(cur.b);
    S.save();
    S.setTransform(DPR, 0, 0, DPR, 0, 0);
    if ('color' === (S.globalCompositeOperation = 'color')) {
      S.fillStyle = `rgba(${r},${gg},${b},${cur.a.toFixed(2)})`;
    } else {
      S.globalCompositeOperation = 'multiply';
      S.fillStyle = `rgba(${r},${gg},${b},0.55)`;
    }
    S.fillRect(0, 0, W, H);
    S.restore();
  };

  /* ---------- 静音 ---------- */
  function mute() { if (window.__bgm) { try { window.__bgm.set(false); } catch (e) { return false; } return true; } return false; }
  [400, 1200, 3000, 6000].forEach((t) => setTimeout(mute, t));


  /* ---------- 点击冲击波：壁纸窗口点击穿透，点击由原生宿主全局转发 ---------- */
  (function initRipple() {
    const cv = document.createElement('canvas');
    cv.id = 'td-ripple';
    cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:8';
    document.body.appendChild(cv);
    const g = cv.getContext('2d');
    let dpr = dprCap();
    const fit = () => {
      dpr = dprCap();
      cv.width = Math.round(innerWidth * dpr);
      cv.height = Math.round(innerHeight * dpr);
    };
    fit();
    addEventListener('resize', fit);
    const ripples = [];
    let raf = 0;
    const LIFE = 1200;
    window.__tdClick = function (x, y) {
      ripples.push({ x, y, t: performance.now() });
      if (ripples.length > 8) ripples.shift();
      if (!raf) raf = requestAnimationFrame(step);
    };
    function step(now) {
      raf = 0;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cv.width, cv.height);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      let alive = 0;
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i], age = now - r.t;
        if (age > LIFE) { ripples.splice(i, 1); continue; }
        alive++;
        const p = age / LIFE, ease = 1 - Math.pow(1 - p, 3);
        const rad = 16 + ease * 300, a = (1 - p) * (1 - p) * 0.5;
        // 冲击波用当前主色（跟着厂商走），没有活动时退回落日红
        const tint = window.__tdTint;
        const cr = tint && tint.a > 0.05 ? Math.round(tint.r) : 228;
        const cg = tint && tint.a > 0.05 ? Math.round(tint.g) : 87;
        const cb = tint && tint.a > 0.05 ? Math.round(tint.b) : 46;
        g.beginPath(); g.arc(r.x, r.y, rad, 0, Math.PI * 2);
        g.strokeStyle = `rgba(${cr},${cg},${cb},${a.toFixed(3)})`;
        g.lineWidth = 0.6 + 2.6 * (1 - p); g.stroke();
        g.beginPath(); g.arc(r.x, r.y, rad * 0.6, 0, Math.PI * 2);
        g.strokeStyle = `rgba(242,239,234,${(a * 0.5).toFixed(3)})`;
        g.lineWidth = 1; g.stroke();
      }
      if (alive) raf = requestAnimationFrame(step);
      else { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); }
    }
  })();

  window.__tdSelfTestClick = function () {
    try {
      const p = toScreen(cx, cy);
      // 连发三次，方便在任意时刻截到正在扩散的冲击波
      [0, 320, 640].forEach((d, i) => setTimeout(() => window.__tdClick(p.x + 40 + i * 30, p.y), d));
      return true;
    } catch (e) { return false; }
  };
  // 冲击波层同样半分辨率导出
  window.__tdRippleShot = function () {
    try { const el = document.getElementById('td-ripple'); return el ? el.toDataURL('image/png') : null; } catch (e) { return null; }
  };

  /* ---------- 版权署名（许可要求保留） ---------- */
  const credit = document.createElement('div');
  credit.textContent = 'HALOFLUX by Ryder191 · github.com/Ryder191/haloflux';
  credit.style.cssText = 'position:fixed;right:10px;bottom:8px;z-index:9;font:10px ui-monospace,monospace;color:rgba(207,210,216,.4);pointer-events:none;letter-spacing:.5px';
  document.body.appendChild(credit);
})();
