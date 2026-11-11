/**
 * 控制台预览的圆环几何换算（与壁纸 halo 的半径公式对齐）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync(new URL("../web/lib/ring-geom.js", import.meta.url), "utf8");
const sandbox = { window: {} };
vm.runInNewContext(code, sandbox);
const { base, clampRing, fromMove, fromResize, pixelRadius, MIN_SCALE, MAX_SCALE } = sandbox.window.TDRing;
const plain = (v) => JSON.parse(JSON.stringify(v));   // vm 沙箱对象跨 realm，先转普通对象再比较

const rect = { left: 100, top: 50, width: 800, height: 450 };

test("半径基准与 halo 一致（max(H*0.78, W*0.30)）", () => {
  assert.equal(base(1920, 1080), 842.4);
  assert.equal(base(800, 450), 351);
});

test("拖拽：指针 → 归一化圆心并夹在 0–1", () => {
  assert.deepEqual(plain(fromMove(rect, 500, 275)), { x: 0.5, y: 0.5 });
  const out = fromMove(rect, -1000, 9999);
  assert.equal(out.x, 0);
  assert.equal(out.y, 1);
});

test("缩放：按指针到圆心的像素距离换算 scale", () => {
  const ring = { x: 0.5, y: 0.5, scale: 0.3 };
  const cx = 500, cy = 275;
  const s = fromResize(rect, ring, cx + base(800, 450) * 0.5, cy);
  assert.ok(Math.abs(s - 0.5) < 0.01, `期望 ~0.5，实际 ${s}`);
});

test("clampRing：越界与非法值回落", () => {
  assert.deepEqual(plain(clampRing({ x: -3, y: 9, scale: 99 })), { x: 0, y: 1, scale: 2.5 });
  assert.equal(clampRing({ scale: 0.01 }).scale, MIN_SCALE);
  assert.equal(MAX_SCALE, 2.5);
  assert.deepEqual(plain(clampRing({})), { x: 0, y: 0, scale: 0.3 });
});

test("pixelRadius：预览像素半径", () => {
  assert.equal(pixelRadius(800, 450, { scale: 0.5 }), 175.5);
});
