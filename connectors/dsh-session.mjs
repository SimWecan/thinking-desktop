/**
 * DeepSeek Harness 会话行 → 统一事件。
 *
 * DSH 以 v4 JSONL 追加写会话（`~/.dsh/sessions/<workspace>/session-<id>/session.v4.jsonl.zstd`），
 * 每行形如 `{ type, seq, time, data }`。本模块只挑真正代表「AI 在思考」的行，
 * 其余元数据/admin 行（title、request、permission、sandbox、job/*、delivery-accepted…）
 * 一律忽略，避免壁纸被空转事件刷成常亮。
 */

// 最近一次请求上下文（request/context）：模型 + 上下文窗口，用来算占用率
let lastRequestContext = { model: null, window: null };

const TEXT_LIMIT = 140;      // 报错等短字段
const THOUGHT_LIMIT = 8000;  // 思考日志：整段保留，只防极端长文

/**
 * @param {any} obj 解析后的会话行
 * @param {string} raw 原始行（解析失败时兜底）
 * @returns {{type: string, payload?: object}|null}
 */
export function summarizeDshLine(obj, raw) {
  if (!obj || typeof obj !== "object") return null;
  const type = String(obj.type ?? "");

  switch (type) {
    case "request/context": {
      const d = obj.data || {};
      if (d.model) lastRequestContext.model = d.model;
      if (d.contextWindow) lastRequestContext.window = d.contextWindow;
      return null; // 元数据行：只拿来补上下文窗口
    }

    case "assistant/message": {
      const ev = fromAssistantMessage(obj);
      const u = obj.data?.usage;
      if (!u) return ev;
      // DSH 每条 assistant/message 都带 usage：input + cacheRead 就是本次送进去的上下文
      const used = (u.inputTokens || 0) + (u.cacheReadTokens || 0);
      const win = lastRequestContext.window || 0;
      const token = {
        type: "token",
        payload: {
          model: lastRequestContext.model || "deepseek",
          used,
          window: win,
          pct: win ? used / win : null,
          output: u.outputTokens ?? null,
        },
      };
      return ev ? [ev, token] : token;
    }

    case "tool/call": {
      const name = obj.data?.name ?? "tool";
      return { type: "tool_call", payload: { name } };
    }

    case "tool/result":
      return { type: "tool_result", payload: {} };

    case "turn/start":
      return { type: "status", payload: { running: 1 } };

    case "turn/end":
      return { type: "status", payload: { running: 0 } };

    case "user/message":
      return null; // 用户输入是提示，不是 AI 思考

    default:
      break;
  }

  if (/error/i.test(type)) {
    return {
      type: "error",
      payload: { message: clip(obj.data?.message ?? obj.data?.error ?? type, TEXT_LIMIT) },
    };
  }
  // 其它（session/title、request/*、permission/*、sandbox/*、job/*、step/*…）都不算活动
  return null;
}

function fromAssistantMessage(obj) {
  const blocks = obj.data?.message?.content;
  if (!Array.isArray(blocks)) return null;

  const reasoning = [];
  const output = [];
  let toolCalls = 0;
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "reasoning" && b.text) reasoning.push(b.text);
    else if (b.type === "text" && b.text) output.push(b.text);
    else if (b.type === "tool-call") toolCalls += 1;
  }

  // 「思考日志」优先：推理整段上墙（不再截成一句话）；没有推理时才退回最终输出
  const think = reasoning.join("\n").trim();
  const reply = output.join("\n").trim();
  const text = think || reply;
  if (text.length >= 2) {
    return {
      type: "text",
      payload: { text: truncate(text, THOUGHT_LIMIT), kind: think ? "think" : "output" },
    };
  }
  if (toolCalls > 0) return { type: "thought", payload: { tools: toolCalls } };
  return null;
}

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n)} …` : s;
}

function clip(s, limit) {
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}
