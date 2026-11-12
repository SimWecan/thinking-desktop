/** 通用文件夹探针的行映射。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapProbeLine } from "../connectors/folder-probe.mjs";

test("JSONL：从常见字段里取文本", () => {
  assert.deepEqual(mapProbeLine('{"text":"正在分析需求"}'), { type: "text", payload: { text: "正在分析需求", kind: "probe" } });
  assert.deepEqual(mapProbeLine('{"message":{"content":"第二段"}}'), { type: "text", payload: { text: "第二段", kind: "probe" } });
  assert.deepEqual(mapProbeLine('{"delta":"流式片段"}'), { type: "text", payload: { text: "流式片段", kind: "probe" } });
});

test("工具调用行", () => {
  assert.deepEqual(mapProbeLine('{"tool":"bash","args":{}}'), { type: "tool_call", payload: { name: "bash" } });
  assert.deepEqual(mapProbeLine('{"type":"tool_call","name":"read_file"}'), { type: "tool_call", payload: { name: "read_file" } });
});

test("纯文本行与噪声", () => {
  assert.deepEqual(mapProbeLine("plain log line"), { type: "text", payload: { text: "plain log line", kind: "probe" } });
  assert.equal(mapProbeLine(""), null);
  assert.equal(mapProbeLine("   "), null);
  assert.equal(mapProbeLine('{"foo":1}'), null);
});
