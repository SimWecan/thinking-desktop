/** 调色盘色彩换算（控制台调色盘用）。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync(new URL("../web/lib/color.js", import.meta.url), "utf8");
const sandbox = { window: {} };
vm.runInNewContext(code, sandbox);
const { hsvToRgb, rgbToHex, hexToRgb, rgbToHsv, hexToHsv, normalizeHex } = sandbox.window.TDColor;

test("HSV → RGB 基础色", () => {
  assert.deepEqual(Array.from(hsvToRgb(0, 0, 0)), [0, 0, 0]);
  assert.deepEqual(Array.from(hsvToRgb(0, 0, 1)), [255, 255, 255]);
  assert.deepEqual(Array.from(hsvToRgb(0, 1, 1)), [255, 0, 0]);
  assert.deepEqual(Array.from(hsvToRgb(120, 1, 1)), [0, 255, 0]);
  assert.deepEqual(Array.from(hsvToRgb(240, 1, 1)), [0, 0, 255]);
});

test("HEX 解析与格式化", () => {
  assert.deepEqual(Array.from(hexToRgb("#8B5CF6")), [139, 92, 246]);
  assert.equal(rgbToHex([139, 92, 246]), "#8B5CF6");
  assert.deepEqual(Array.from(hexToRgb("abc")), [170, 187, 204]);
  assert.equal(hexToRgb("nope"), null);
});

test("HSV 往返一致", () => {
  const hsv = hexToHsv("#1E3A8A");
  assert.ok(Math.abs(hsv.h - 224) < 2);
  assert.equal(rgbToHex(hsvToRgb(hsv.h, hsv.s, hsv.v)), "#1E3A8A");
});

test("normalizeHex 容错", () => {
  assert.equal(normalizeHex("#abc", "#000000"), "#AABBCC");
  assert.equal(normalizeHex("zzz", "#123456"), "#123456");
});
