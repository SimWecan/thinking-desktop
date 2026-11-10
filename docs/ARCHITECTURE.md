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
  type:
    | "thought"      // 推理/输出中（无文本可上墙时的轻量信号）
    | "tool_call"    // 发起一次工具调用（payload.name）
    | "tool_result"  // 工具返回结果
    | "token"        // token 计量
    | "error"        // 报错（payload.message）
    | "status"       // 状态变化（payload.running 等）
    | "text";        // 截流到的真实思考/输出文本（payload.text，右侧视窗展示）
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
| `GET /health` | 自检：zstd 是否可用、已注册 connector、各来源最后一次真实事件距今多久 |

## 空闲判定

客户端以「最后一次真实工作信号」为准：任一来源 30 s 内没有 token/文本/工具/状态事件 → 进入待命形态（环带原地停转、粒子隐没、退出 rAF 由事件驱动重绘）；重新收到事件立即恢复思考形态。服务端 `/state` 同时给出 `idleMs` 与每个来源的 `agoMs` 便于排查「到底是谁在驱动壁纸」。

## Connector 实现指南

继承 `connectors/base.mjs` 的 `Connector` 类，实现 `start()`：在检测到活动时用 `this.emit(event)` 上报即可。
现有实现：

- `FileTailConnector`：尾随任意文本文件（日志、jsonl 会话），按行正则提取事件类型。
- `ZstdJsonlPollConnector`：面向以 zstd 多帧追加写的会话文件（DSH）。递归发现 `dir/workspace/session-*/session.v4.jsonl.zstd`，同时跟踪多个活跃会话；按 size/mtime 判断是否变化，避免每轮全量解码；启动时登记偏移量、不回放历史，文件被重写回滚时不刷屏。
- `summarizeDshLine`（`connectors/dsh-session.mjs`）：把 DSH v4 会话行映射成事件——`assistant/message` 取输出/推理文本 → `text`，`tool/call` / `tool/result` → 对应事件，`turn/*` → `status`，其余元数据行（title、request、permission、sandbox、job、step、delivery-accepted）一律忽略，防止壁纸被空转事件刷成常亮。
- `KimiWireConnector`：尾随 Kimi 桌面端会话落盘 wire.jsonl（`sessions/<workspace>/conv-xxxx/agents/main/wire.jsonl`），提取用户消息、助手输出、工具调用与 `context.apply_compaction` 真实文本截流事件；自动跟随最近活跃的会话文件。
