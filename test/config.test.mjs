/**
 * config/ui.json 的默认值与合法性校验。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUiConfig, UI_DEFAULTS } from "../server/config.mjs";

test("缺省时返回默认值", () => {
  assert.deepEqual(normalizeUiConfig(null), { ...UI_DEFAULTS });
  assert.deepEqual(normalizeUiConfig({}), { ...UI_DEFAULTS });
});

test("合法值被采用", () => {
  const c = normalizeUiConfig({ ringText: "full", panel: "always", holdSec: 45, lightsWindowSec: 20, ringChars: 120 });
  assert.equal(c.ringText, "full");
  assert.equal(c.panel, "always");
  assert.equal(c.holdSec, 45);
  assert.equal(c.lightsWindowSec, 20);
  assert.equal(c.ringChars, 120);
});

test("越界/非法值回落到默认", () => {
  const c = normalizeUiConfig({ ringText: "weird", panel: "x", holdSec: 9999, lightsWindowSec: -1, ringChars: "abc" });
  assert.equal(c.ringText, "headline");
  assert.equal(c.panel, "hover");
  assert.equal(c.holdSec, 600);        // 夹到上限
  assert.equal(c.lightsWindowSec, 3);  // 夹到下限
  assert.equal(c.ringChars, UI_DEFAULTS.ringChars);
});
