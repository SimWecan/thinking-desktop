/**
 * Codex 日志行 → 事件类型。
 *
 * `~/.codex/logs_2.sqlite` 是个混合日志库：绝大多数行是配置加载、HTTP 客户端、
 * OTEL 指标之类的噪声（真实样本里 800 行有 700+ 是这类），原来的关键字匹配
 * （tool/turn/response）既漏又吵。这里按 target / level 分类：
 *   - ERROR 级别                      → error
 *   - 明确的工具执行/补丁目标           → tool_call
 *   - 回合与流式输出的核心模块          → thought
 *   - 其余（config/http/otel/login…）  → 忽略
 */

const NOISE = /codex_config::|codex_http_client|codex_otel|codex_login|codex_skills|codex_models_manager|codex_core::session|codex_state::|codex_core_plugins/i;
const TOOL = /(apply_patch|shell|exec_command|tool_call|tool_result|mcp_tool|spawn_command|run_command)/i;
const TURN = /(stream_events|outgoing_message|message_processor|response\.|completion|turn_)/i;

/**
 * @param {{level?: string, target?: string, feedback_log_body?: string}} row
 * @returns {"error"|"tool_call"|"thought"|null}
 */
export function mapCodexLogRow(row) {
  const level = String(row?.level || "");
  const target = String(row?.target || "");
  const body = String(row?.feedback_log_body || "");
  const text = `${target} ${body}`;

  if (level === "ERROR") return "error";
  if (NOISE.test(target)) return null;
  if (TOOL.test(text)) return "tool_call";
  if (TURN.test(text)) return "thought";
  return null;
}
