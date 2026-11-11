/**
 * 壁纸页的纯逻辑（停环判定 / 活跃来源 / 曲线归一化 / 柱高）单测。
 * 运行：node --test test/*.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync(new URL("../web/lib/td-logic.js", import.meta.url), "utf8");
const sandbox = { window: {} };
vm.runInNewContext(code, sandbox);
const { shouldStandby, winddownCalm, activeSources, normalizeSeries, agentBars } = sandbox.window.TDLogic;

test("动态静默：空闲占过渡窗口的比例匀速爬升，窗口末到达 1", () => {
  const now = 1_000_000;
  assert.equal(winddownCalm({ now, workAt: now, busyUntil: 0, winddown: 30000 }), 0);
  assert.equal(+winddownCalm({ now, workAt: now - 7500, busyUntil: 0, winddown: 30000 }).toFixed(2), 0.25);
  assert.equal(+winddownCalm({ now, workAt: now - 15000, busyUntil: 0, winddown: 30000 }).toFixed(2), 0.5);
  assert.equal(winddownCalm({ now, workAt: now - 30000, busyUntil: 0, winddown: 30000 }), 1);
  assert.equal(winddownCalm({ now, workAt: now - 99999, busyUntil: 0, winddown: 30000 }), 1);   // 封顶
});

test("动态静默：busyUntil 未到期保持全速；窗口内按比例爬升", () => {
  const now = 1_000_000;
  assert.equal(winddownCalm({ now, workAt: now - 99999, busyUntil: now + 5000, winddown: 30000 }), 0);
  assert.equal(winddownCalm({ now, workAt: now, busyUntil: 0, winddown: 30000 }), 0);
});

test("动态静默：单一形态只看选中 agent，思考即全速、不思考即静默", () => {
  const now = 1_000_000;
  const agents = [{ source: "kimi-desktop", thinking: true }, { source: "codex", thinking: false }];
  assert.equal(winddownCalm({ now, workAt: now - 99999, busyUntil: 0, winddown: 30000, view: "kimi-desktop", agents }), 0);
  assert.equal(winddownCalm({ now, workAt: now, busyUntil: 0, winddown: 30000, view: "codex", agents }), 1);
});

test("停环：超过 hold 没工作信号才进待机", () => {
  const now = 1_000_000;
  assert.equal(shouldStandby({ now, workAt: now - 5000, busyUntil: 0, hold: 20000 }), false);
  assert.equal(shouldStandby({ now, workAt: now - 25000, busyUntil: 0, hold: 20000 }), true);
});

test("停环：busyUntil 未到期时不待机（回合进行中）", () => {
  const now = 1_000_000;
  assert.equal(shouldStandby({ now, workAt: now - 30000, busyUntil: now + 5000, hold: 20000 }), false);
});

test("停环：单一形态只看选中 agent 的 thinking", () => {
  const now = 1_000_000;
  const agents = [{ source: "kimi-desktop", thinking: true }, { source: "codex", thinking: false }];
  assert.equal(shouldStandby({ now, workAt: now - 99999, busyUntil: 0, hold: 20000, view: "kimi-desktop", agents }), false);
  assert.equal(shouldStandby({ now, workAt: now, busyUntil: 0, hold: 20000, view: "codex", agents }), true);
});

test("活跃来源：status 与超时的不算", () => {
  const list = [
    { source: "a", agoMs: 3000, lastType: "text" },
    { source: "b", agoMs: 3000, lastType: "status" },
    { source: "c", agoMs: 20000, lastType: "text" },
  ];
  assert.deepEqual(activeSources(list, 12000).map((x) => x.source), ["a"]);
});

test("曲线归一化：补齐到 60 点且过滤非法值", () => {
  const out = normalizeSeries([1, null, "x", 4], 6);
  assert.equal(out.length, 6);
  assert.deepEqual(Array.from(out.slice(-4)), [1, 0, 0, 4]);
});

test("agent 柱高按累计事件占比", () => {
  const bars = agentBars([
    { source: "a", events: 10 },
    { source: "b", events: 5 },
    { source: "c", events: 0 },
    { source: "d", events: 99, enabled: false },
  ]);
  // 结果来自 vm 沙箱的另一个 realm，先转成本 realm 的普通对象再比较
  assert.deepEqual(JSON.parse(JSON.stringify(bars)),
    [{ source: "a", pct: 100 }, { source: "b", pct: 50 }, { source: "c", pct: 0 }]);
});

test("headline：取首句，超长截断", () => {
  const { headline } = sandbox.window.TDLogic;
  assert.equal(headline("先跑测试。然后再说别的。", 90), "先跑测试。");
  assert.equal(headline("no punctuation just a long sentence that keeps going and going", 30).length <= 30, true);
  assert.equal(headline("", 90), "");
});
