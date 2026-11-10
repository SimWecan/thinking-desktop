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
| `GET /health` | 自检：zstd 是否可用、每个来源的连接通道（session/file/sqlite/json/process/activity）、事件数与最后事件、闭源端最近一次 CPU 采样 |

## 呈现规则

- **环形数据块**：思考态用真实截流文本填充（`window.__tdRingText`）；闭源 AI 没有文本通道时退回 HALOFLUX 预设动画。
- **右侧视窗**：所有截流文本同时按来源（DSH / Kimi / Codex）逐行展示，120s 内无新文本自动收起。
- **鼠标**：不与环带互动（无悬停放大/特写）；只有点击会被原生宿主全局转发，触发冲击波。
- **待机**：环带原地停转（保留最后一屏文本），粒子隐没，退出 rAF 由事件唤醒。

## 空闲判定

客户端以「最后一次真实工作信号」为准：任一来源 30 s 内没有 token/文本/工具/状态事件 → 进入待命形态（环带原地停转、粒子隐没、退出 rAF 由事件驱动重绘）；重新收到事件立即恢复思考形态。服务端 `/state` 同时给出 `idleMs` 与每个来源的 `agoMs` 便于排查「到底是谁在驱动壁纸」。

## Connector 实现指南

继承 `connectors/base.mjs` 的 `Connector` 类，实现 `start()`：在检测到活动时用 `this.emit(event)` 上报即可。
现有实现：

- `FileTailConnector`：尾随任意文本文件（日志、jsonl 会话），按行正则提取事件类型。
- `ZstdJsonlPollConnector`：面向以 zstd 多帧追加写的会话文件（DSH）。递归发现 `dir/workspace/session-*/session.v4.jsonl.zstd`，同时跟踪多个活跃会话；按 size/mtime 判断是否变化，避免每轮全量解码；启动时登记偏移量、不回放历史，文件被重写回滚时不刷屏。
- `ProcessActivityConnector`：闭源桌面端（Gemini / ChatGPT）没有本地文本通道，用 `/bin/ps` 采样该 App 全部进程的 CPU 合计值作为真实工作信号：超过阈值（默认 8%）即按 1.2s 节流上报 `thought`，低于阈值持续 6s 静默复位；`/health.activity` 暴露最近一次采样值便于调阈值。
- `summarizeDshLine`（`connectors/dsh-session.mjs`）：把 DSH v4 会话行映射成事件——`assistant/message` 取输出/推理文本 → `text`，`tool/call` / `tool/result` → 对应事件，`turn/*` → `status`，其余元数据行（title、request、permission、sandbox、job、step、delivery-accepted）一律忽略，防止壁纸被空转事件刷成常亮。
- `KimiWireConnector`：尾随 Kimi 桌面端会话落盘 wire.jsonl（`sessions/<workspace>/conv-xxxx/agents/main/wire.jsonl`），解析 Kimi 3.x 的真实行型：`agent.message.appended`（user/assistant → 真实文本）、`context.append_loop_event` 的 `content.part`（think/text）、`tool.call` / `tool.result`，以及 `context.apply_compaction` 截流摘要；自动跟随最近活跃的会话文件，`stop()` 可干净退出。
