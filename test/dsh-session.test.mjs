/**
 * DSH 会话行 → 统一事件 的映射规则（防止壁纸被元数据行空转刷亮，或漏掉真实思考）。
 * 运行：node --test test/
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeDshLine } from "../connectors/dsh-session.mjs";

const line = (type, data = {}) => ({ type, seq: 1, time: Date.now(), data });

test("assistant/message：有输出优先上墙输出文本", () => {
  const ev = summarizeDshLine(line("assistant/message", {
    message: { content: [
      { type: "reasoning", text: "先看看目录结构" },
      { type: "text", text: "已经修好了 connector" },
    ] },
  }));
  assert.equal(ev.type, "text");
  assert.equal(ev.payload.text, "已经修好了 connector");
});

test("assistant/message：只有推理时上墙推理文本，并压成单行", () => {
  const ev = summarizeDshLine(line("assistant/message", {
    message: { content: [{ type: "reasoning", text: "第一行\n\n第二行   有空格" }] },
  }));
  assert.equal(ev.type, "text");
  assert.equal(ev.payload.text, "第一行 第二行 有空格");
});

test("assistant/message：纯工具调用不算文本事件", () => {
  const ev = summarizeDshLine(line("assistant/message", {
    message: { content: [{ type: "tool-call", id: "c1", name: "bash" }] },
  }));
  assert.equal(ev.type, "thought");
  assert.equal(ev.payload.tools, 1);
});

test("tool/call 带上工具名，tool/result 记一次结果", () => {
  assert.deepEqual(summarizeDshLine(line("tool/call", { name: "bash" })), {
    type: "tool_call", payload: { name: "bash" },
  });
  assert.equal(summarizeDshLine(line("tool/result", {})).type, "tool_result");
});

test("元数据行不产生事件（否则壁纸永远常亮）", () => {
  for (const type of [
    "session", "session/title", "request/header", "request/context",
    "permission/preset", "sandbox/mode", "approval/policy",
    "job/registered", "job/settled", "step/start", "step/end",
    "session-log-deepseek/delivery-accepted", "user/message",
  ]) {
    assert.equal(summarizeDshLine(line(type)), null, `${type} 不应算作思考事件`);
  }
});

test("报错行 → error", () => {
  const ev = summarizeDshLine(line("error", { message: "model overloaded" }));
  assert.equal(ev.type, "error");
  assert.match(ev.payload.message, /overloaded/);
});

test("坏行/空行安全返回 null", () => {
  assert.equal(summarizeDshLine(null, "not json"), null);
  assert.equal(summarizeDshLine(undefined, ""), null);
});
