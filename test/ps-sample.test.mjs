/**
 * 共享进程快照的纯函数：CPU 汇总与进程名匹配。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { sumByMatch, hasProcess } from "../connectors/ps-sample.mjs";

const LIST = [
  { pid: 1, cpu: 2.5, comm: "/Applications/Gemini.app/Contents/MacOS/Gemini" },
  { pid: 2, cpu: 1.5, comm: "/Applications/Gemini.app/Contents/Frameworks/Helper" },
  { pid: 3, cpu: 9, comm: "/usr/bin/sleep" },
];

test("按子串汇总 CPU", () => {
  assert.deepEqual(sumByMatch(LIST, "/Gemini.app/"), { cpu: 4, procs: 2 });
  assert.deepEqual(sumByMatch(LIST, "/Nope/"), { cpu: 0, procs: 0 });
});

test("按正则汇总 CPU", () => {
  assert.deepEqual(sumByMatch(LIST, /Gemini\.app\/Contents\/MacOS/), { cpu: 2.5, procs: 1 });
});

test("进程名精确匹配（basename）", () => {
  assert.equal(hasProcess(LIST, "Gemini"), true);
  assert.equal(hasProcess(LIST, "sleep"), true);
  assert.equal(hasProcess(LIST, "Gem"), false);
  assert.equal(hasProcess(null, "Gemini"), false);
});
