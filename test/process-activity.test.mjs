/**
 * 闭源桌面端的活动度检测：解析 ps 输出、按进程路径汇总 CPU。
 * 运行：node --test test/*.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePsCpu } from "../connectors/process-activity.mjs";

const PS = `
  33409  22.5 /Applications/Gemini.app/Contents/MacOS/Gemini
  33539   0.1 /Applications/Gemini.app/Contents/Helpers/GeminiAppLauncher.app/Contents/MacOS/GeminiAppLauncher
  33580   4.3 /Applications/Gemini.app/Contents/Helpers/agy --hub --hub-port=52618
    92091   0.0 /Applications/Kimi.app/Contents/MacOS/Kimi
  91623   0.2 /System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/com.apple.WebKit.WebContent.xpc/Contents/MacOS/com.apple.WebKit.WebContent
`;
// 上面是测试用假数据（不是真实进程表）

test("按 App 路径汇总 CPU（含 helper 子进程）", () => {
  const r = parsePsCpu(PS, "/Gemini.app/");
  assert.equal(r.procs, 3);
  assert.equal(Math.round(r.cpu * 10) / 10, 26.9);
});

test("不匹配其它 App / 系统进程", () => {
  assert.equal(parsePsCpu(PS, "/ChatGPT.app/").procs, 0);
  assert.equal(parsePsCpu(PS, "/Kimi.app/").procs, 1);
});

test("支持正则匹配", () => {
  const r = parsePsCpu(PS, /Gemini\.app\/Contents\/Helpers/);
  assert.equal(r.procs, 2);
});

test("comm 里带空格也能解析", () => {
  const out = `  51662   9.5 /Applications/Kimi.app/Contents/Frameworks/Kimi Helper (Renderer).app/Contents/MacOS/Kimi Helper (Renderer)\n`;
  const r = parsePsCpu(out, "/Kimi.app/");
  assert.equal(r.procs, 1);
  assert.equal(r.cpu, 9.5);
});

test("空输入安全", () => {
  assert.deepEqual(parsePsCpu("", "/Gemini.app/"), { cpu: 0, procs: 0 });
  assert.deepEqual(parsePsCpu(null, "/Gemini.app/"), { cpu: 0, procs: 0 });
});
