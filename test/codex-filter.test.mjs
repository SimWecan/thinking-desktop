/**
 * Codex 日志过滤：样本取自本机 ~/.codex/logs_2.sqlite 的真实行型。
 * 运行：node --test test/*.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mapCodexLogRow } from "../connectors/codex-filter.mjs";

const row = (level, target, body = "") => ({ level, target, feedback_log_body: body });

test("配置加载 / HTTP / OTEL 这类噪声全部忽略", () => {
  for (const target of [
    "codex_config::loader::macos",
    "codex_config::loader::layer_io",
    "codex_http_client::client",
    "codex_http_client::custom_ca",
    "codex_otel::metrics::client",
    "codex_models_manager::cache",
    "codex_login::auth::manager",
  ]) {
    assert.equal(mapCodexLogRow(row("DEBUG", target, "flushing OTEL metrics")), null, target);
  }
});

test("ERROR 级别一律算错误", () => {
  assert.equal(mapCodexLogRow(row("ERROR", "codex_config::loader::macos", "failed to read")), "error");
});

test("工具执行 / 补丁应用到 tool_call", () => {
  assert.equal(mapCodexLogRow(row("INFO", "codex_core::tools", "apply_patch ok")), "tool_call");
  assert.equal(mapCodexLogRow(row("INFO", "codex_core::exec", "shell command started")), "tool_call");
  assert.equal(mapCodexLogRow(row("TRACE", "codex_mcp::tool", "mcp_tool call finished")), "tool_call");
});

test("回合 / 流式输出算思考", () => {
  assert.equal(mapCodexLogRow(row("TRACE", "codex_core::stream_events_utils", "stream chunk")), "thought");
  assert.equal(mapCodexLogRow(row("TRACE", "codex_app_server::outgoing_message", "response.delta")), "thought");
  assert.equal(mapCodexLogRow(row("TRACE", "codex_app_server::message_processor", "app-server request")), "thought");
});

test("普通 INFO 生命周期事件不误报", () => {
  assert.equal(mapCodexLogRow(row("INFO", "rmcp::service", "Service initialized as client")), null);
  assert.equal(mapCodexLogRow(row("INFO", "codex_core_plugins::manager", "loaded plugin")), null);
});
