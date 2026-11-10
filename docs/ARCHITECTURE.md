# Thinking Desktop — 架构说明

## 设计目标

1. **一切皆事件**：任何本机 AI 软件的活动都被归一化为一条事件流，壁纸只消费事件流。
2. **零依赖**：服务端只用 Node 标准库，便于在壁纸机长期驻留。
3. **可扩展**：新增一个 AI 软件 = 新增一个 Connector 文件并在 `server/index.mjs` 注册。

## 统一事件协议

每个 Connector 产出如下结构的 Event：

```ts
type ThinkingEvent = {
  source: string;                 // 来源标识，如 "claude-code"、"kimi-desktop"
  type: "thought" | "tool_call" | "tool_result" | "token" | "error" | "status";
  ts: number;                     // Unix 毫秒时间戳
  payload?: Record<string, any>; // 可选详情：工具名、token 数、模型名等
};
```

## 服务端 API

| 端点 | 说明 |
|---|---|
| `GET /stream` | SSE 长连接，实时推送 ThinkingEvent 与聚合状态 |
| `GET /state` | 一次性 JSON：当前事件速率、各来源活跃度、最近事件 |
| `GET /wall` | 壁纸页面（即 `web/index.html`） |

## 空闲判定

服务端维护 `lastEventAt`。客户端据此计算 `idleSeconds`，超过阈值（默认 4 s）进入待命模式：时间轴降至 10%，粒子缓慢漂移。

## Connector 实现指南

继承 `connectors/base.mjs` 的 `Connector` 类，实现 `start()`：在检测到活动时用 `this.emit(event)` 上报即可。
现有实现：

- `FileTailConnector`：尾随任意文本文件（日志、jsonl 会话），按行正则提取事件类型。
