/**
 * Kimi 桌面端 wire.jsonl 真实落盘格式的解析（Kimi 3.2.x）。
 * 运行：node --test test/*.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KimiWireConnector } from "../connectors/kimi-wire.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function wireFixture() {
  const root = mkdtempSync(join(tmpdir(), "td-kimi-"));
  const conv = join(root, "wd_demo", "conv-abc", "agents", "main");
  mkdirSync(conv, { recursive: true });
  return { root, file: join(conv, "wire.jsonl") };
}

const append = (file, obj) => appendFileSync(file, JSON.stringify(obj) + "\n");
const userMsg = (text) => ({
  type: "agent.message.appended", kind: "event", time: Date.now(),
  message: { message: { role: "user", content: [{ type: "text", text }] }, meta: { source: "input" } },
});
const assistantMsg = (text) => ({
  type: "agent.message.appended", kind: "event", time: Date.now(),
  message: { message: { role: "assistant", content: [{ type: "text", text }] }, meta: {} },
});
const loopEvent = (event) => ({ type: "context.append_loop_event", agentId: "main", event, time: Date.now() });

test("识别 Kimi 真实格式：用户 / 助手消息 + 工具调用与结果", async () => {
  const { root, file } = wireFixture();
  writeFileSync(file, "");                       // 先建文件，连接器从 EOF 开始
  const events = [];
  const c = new KimiWireConnector({ dir: root, minTextIntervalMs: 0, rescanMs: 50 });
  c.onEvent = (e) => events.push(e);
  c.start();
  await wait(100);
  c._drain();                                     // 确保已挂上当前文件

  append(file, userMsg("把这几个 connector 接好"));
  append(file, loopEvent({ type: "tool.call", name: "Bash", toolCallId: "t1" }));
  append(file, loopEvent({ type: "tool.result", toolCallId: "t1", result: { output: "ok" } }));
  append(file, loopEvent({ type: "content.part", part: { type: "think", think: "先看看目录结构再说" } }));
  append(file, assistantMsg("已经全部接通了"));
  c._drain();
  c.stop();

  const types = events.map((e) => e.type);
  assert.ok(types.includes("tool_call"), "tool.call 应映射为 tool_call");
  assert.ok(types.includes("tool_result"), "tool.result 应映射为 tool_result");
  const texts = events.filter((e) => e.type === "text").map((e) => e.payload.text);
  assert.ok(texts.some((t) => t.includes("把这几个 connector 接好")), "用户消息应上墙");
  assert.ok(texts.some((t) => t.includes("先看看目录结构")), "推理文本应上墙");
  assert.ok(texts.some((t) => t.includes("已经全部接通了")), "助手输出应上墙");

  const think = events.find((e) => e.type === "text" && e.payload.kind === "think");
  assert.ok(think, "推理片段应标注 kind=think");
  assert.equal(think.payload.stream, true, "推理片段是流式快照");
  assert.ok(think.payload.text.includes("先看看目录结构"), "整段保留，不截成一句");
});

test("tool 角色的消息不重复上墙（结果已由 tool.result 覆盖）", async () => {
  const { root, file } = wireFixture();
  writeFileSync(file, "");
  const events = [];
  const c = new KimiWireConnector({ dir: root, minTextIntervalMs: 0, rescanMs: 50 });
  c.onEvent = (e) => events.push(e);
  c.start();
  await wait(100);
  c._drain();
  append(file, {
    type: "agent.message.appended", kind: "event",
    message: { message: { role: "tool", content: [{ type: "text", text: "命令输出一长串" }] } },
  });
  c._drain();
  c.stop();
  assert.equal(events.length, 0);
});

test("截流摘要（context.apply_compaction）带 ⟲ 标记上墙", async () => {
  const { root, file } = wireFixture();
  writeFileSync(file, "");
  const events = [];
  const c = new KimiWireConnector({ dir: root, minTextIntervalMs: 0, rescanMs: 50 });
  c.onEvent = (e) => events.push(e);
  c.start();
  await wait(100);
  c._drain();
  append(file, { type: "context.apply_compaction", summary: "上下文压缩：保留了项目约束" });
  c._drain();
  c.stop();
  const t = events.find((e) => e.type === "text");
  assert.ok(t && t.payload.text.startsWith("⟲ 截流"), "应带截流标记");
});
