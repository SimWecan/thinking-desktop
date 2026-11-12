/**
 * 控制台「桌面预览」的几何换算（纯函数）：圆环底色基准半径、环带厚度、拖拽移动、缩放。
 * 壁纸的光环按 R = max(H*0.78, W*0.30) * scale、RO = R + band 计算；
 * 预览把 iframe 按桌面逻辑分辨率渲染后再整体缩放，所以这里的 w/h 也可以直接传桌面尺寸。
 */
(function (root) {
  "use strict";

  const MIN_SCALE = 0.15, MAX_SCALE = 2.5;

  /** 光环半径基准（与 halo 的 resizeStage 保持一致） */
  function base(w, h) { return Math.max(h * 0.78, w * 0.30); }

  /** 环带厚度基准（halo 的 RO - R，未乘 ringWidth） */
  function band(w, h) { return Math.max(90, Math.min(240, h * 0.3, w * 0.13)); }

  function clampRing(r) {
    return {
      x: Math.max(0, Math.min(1, Number(r?.x) || 0)),
      y: Math.max(0, Math.min(1, Number(r?.y) || 0)),
      scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, Number(r?.scale) || 0.3)),
    };
  }

  /** 拖拽：指针位置 → 归一化圆心 */
  function fromMove(rect, clientX, clientY) {
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / (rect.width || 1))),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / (rect.height || 1))),
    };
  }

  /** 缩放：指针到圆心的像素距离 → scale */
  function fromResize(rect, ring, clientX, clientY) {
    const cx = rect.left + ring.x * rect.width;
    const cy = rect.top + ring.y * rect.height;
    const px = Math.hypot(clientX - cx, clientY - cy);
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, px / base(rect.width, rect.height)));
  }

  /** 当前 ring 在预览画布上的像素半径 */
  function pixelRadius(w, h, ring) { return base(w, h) * (ring?.scale || 0); }

  root.TDRing = { base, band, clampRing, fromMove, fromResize, pixelRadius, MIN_SCALE, MAX_SCALE };
})(typeof window !== "undefined" ? window : globalThis);
