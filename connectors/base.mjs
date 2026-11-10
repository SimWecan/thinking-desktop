/**
 * Connector 基类：所有 AI 软件适配器的统一接口。
 * 子类实现 start()，在检测到活动时调用 this.emit(event) 上报事件。
 */

export const EVENT_TYPES = [
  "thought",      // 推理/输出中
  "tool_call",    // 发起一次工具调用
  "tool_result",  // 工具返回结果
  "token",        // token 计量
  "error",        // 报错
  "status",       // 状态变化（开始/结束任务等）
  "text",         // 截流到的思考/输出文本片段（开源 AI 本地落盘内容）
];

export class Connector {
  /**
   * @param {string} source 来源标识，如 "claude-code"
   */
  constructor(source) {
    this.source = source;
    /** @type {(e: object) => void} */
    this.onEvent = null;
  }

  /** @param {{type: string, payload?: object}} e */
  emit(e) {
    if (!EVENT_TYPES.includes(e.type)) {
      throw new Error(`[${this.source}] unknown event type: ${e.type}`);
    }
    const event = {
      source: this.source,
      type: e.type,
      ts: Date.now(),
      payload: e.payload ?? {},
    };
    this.onEvent?.(event);
  }

  /** 子类实现：启动监听 */
  start() {
    throw new Error(`${this.source}: start() not implemented`);
  }
}
