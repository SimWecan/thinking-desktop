/**
 * DSH 会话行 → 统一事件 的映射规则（防止壁纸被元数据行空转刷亮，或漏掉真实思考）。
 * 运行：node --test test/
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeDshLine } from "../connectors/dsh-session.mjs";

const line = (type, data = {}) => ({ type, seq: 1, time: Date.now(), data });

test("assistant/message：优先上墙思考日志（reasoning）", () => {
  const ev = summarizeDshLine(line("assistant/message", {
    message: { content: [
      { type: "reasoning", text: "先看看目录结构" },
      { type: "text", text: "已经修好了 connector" },
    ] },
  }));
  assert.equal(ev.type, "text");
  assert.equal(ev.payload.text, "先看看目录结构");
  assert.equal(ev.payload.kind, "think");
});

test("assistant/message：没有推理时才退回最终输出", () => {
  const ev = summarizeDshLine(line("assistant/message", {
    message: { content: [{ type: "text", text: "这是最终回答" }] },
  }));
  assert.equal(ev.payload.text, "这是最终回答");
  assert.equal(ev.payload.kind, "output");
});

test("长思考日志整段保留，不再截成一句话", () => {
  const long = "第一步：读取会话文件。".repeat(40);   // 480 字
  const ev = summarizeDshLine(line("assistant/message", {
    message: { content: [{ type: "reasoning", text: long }] },
  }));
  assert.ok(ev.payload.text.length >= 400, "不应被截断");
});

test("assistant/message：推理文本保留换行（右侧视窗按原文展示）", () => {
  const ev = summarizeDshLine(line("assistant/message", {
    message: { content: [{ type: "reasoning", text: "第一行\n第二行  有空格" }] },
  }));
  assert.equal(ev.type, "text");
  assert.equal(ev.payload.text, "第一行\n第二行  有空格");
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

test("assistant/message 带 usage：同时产出 token 事件（含上下文占用率）", () => {
  // request/context 提供模型与上下文窗口
  assert.equal(summarizeDshLine(line("request/context", { model: "deepseek-flash", contextWindow: 1000000 })), null);
  const ev = summarizeDshLine(line("assistant/message", {
    usage: { inputTokens: 120000, cacheReadTokens: 30000, outputTokens: 500, totalTokens: 150500 },
    message: { content: [{ type: "reasoning", text: "继续排查" }] },
  }));
  assert.ok(Array.isArray(ev), "带 usage 时应返回 [text, token]");
  const tok = ev.find((e) => e.type === "token");
  assert.ok(tok, "应包含 token 事件");
  assert.equal(tok.payload.used, 150000);
  assert.equal(tok.payload.window, 1000000);
  assert.ok(Math.abs(tok.payload.pct - 0.15) < 1e-9);
  assert.equal(tok.payload.model, "deepseek-flash");
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
