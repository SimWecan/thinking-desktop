/**
 * config/ui.json 的默认值与合法性校验。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUiConfig, UI_DEFAULTS } from "../server/config.mjs";

test("圆环几何：越界值被夹取", () => {
  const c = normalizeUiConfig({ ring: { x: 99, y: -9, scale: 0 } });
  assert.equal(c.ring.x, 1.5);
  assert.equal(c.ring.y, -0.5);
  assert.equal(c.ring.scale, 0.4);
});

test("缺省时返回默认值", () => {
  assert.deepEqual(normalizeUiConfig(null), { ...UI_DEFAULTS, ring: { ...UI_DEFAULTS.ring } });
  assert.deepEqual(normalizeUiConfig({}), { ...UI_DEFAULTS, ring: { ...UI_DEFAULTS.ring } });
});

test("合法值被采用", () => {
  const c = normalizeUiConfig({ ringText: "full", panel: "always", winddownSec: 45, lightsWindowSec: 20, ringChars: 120, ring: { x: 0.3, y: 0.6, scale: 1.4 } });
  assert.equal(c.ringText, "full");
  assert.equal(c.panel, "always");
  assert.equal(c.winddownSec, 45);
  assert.equal(c.lightsWindowSec, 20);
  assert.equal(c.ringChars, 120);
  assert.deepEqual(c.ring, { x: 0.3, y: 0.6, scale: 1.4 });
});

test("越界/非法值回落到默认", () => {
  const c = normalizeUiConfig({ ringText: "weird", panel: "x", winddownSec: 9999, lightsWindowSec: -1, ringChars: "abc" });
  assert.equal(c.ringText, "headline");
  assert.equal(c.panel, "hover");
  assert.equal(c.winddownSec, 600);        // 夹到上限
  assert.equal(c.lightsWindowSec, 3);  // 夹到下限
  assert.equal(c.ringChars, UI_DEFAULTS.ringChars);
  assert.deepEqual(c.ring, { ...UI_DEFAULTS.ring });
});
