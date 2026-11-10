# Thinking Desktop

把本机所有大模型桌面端软件的「思考过程」具像化为一张实时桌面壁纸。

当任何一个 AI 助手正在推理、调用工具、输出内容时，壁纸随之流动、发光、加速；
全部空闲时，画面进入慢速待命的呼吸状态。灵感与架构参考 [dsh-hud-haloflux](https://github.com/ACyCar1o/dsh-hud-haloflux)（DSH × HALOFLUX），但本仓库为独立原创实现。

## 特性

- **多源接入**：统一抽象 Connector，接入 Claude Code / Codex / Kimi / ChatGPT 桌面版等本机 AI 软件的事件流（日志、会话文件、UI Automation）
- **事件驱动**：推理中 → 粒子流加速；工具调用 → 光束脉冲；报错 → 红色闪烁加密
- **空闲待命**：持续 N 秒无事件自动降为低速漂移，不空转
- **零第三方依赖**：服务端仅使用 Node.js 标准库
- **壁纸化**：输出为单页 Web，可被 Lively Wallpaper / Wallpaper Engine 以 URL 方式设为壁纸
- **跨平台**：macOS / Windows / Linux 均可运行（桌面端状态读取按平台适配）

## 架构

```
各 AI 桌面端 (Claude Code / Codex / Kimi / ChatGPT …)
   │  日志文件 / 会话 jsonl / UI Automation
   ▼
connectors/            ← 每个 AI 软件一个适配器，产出统一事件
   │  { source, type: thought|tool_call|tool_result|error|token, ts, payload }
   ▼
server/index.mjs       ← 事件汇聚、速率统计、SSE 推送 (127.0.0.1:7799)
   │  GET /stream (SSE) · GET /state (JSON)
   ▼
web/index.html         ← Canvas 可视化（思考粒子海），壁纸引擎加载
   ▼
Lively Wallpaper / Wallpaper Engine
```

## 快速开始

```bash
# 需要 Node.js 20+
node server/index.mjs          # 启动数据服务，监听 127.0.0.1:7799

# 浏览器打开 http://127.0.0.1:7799 预览效果
# Lively Wallpaper → 添加壁纸 → URL → http://127.0.0.1:7799/wall
```

## 目录

| 路径 | 说明 |
|---|---|
| `server/index.mjs` | 数据服务：事件汇聚、速率统计、SSE / JSON API；按本机软件自动注册 connector |
| `connectors/base.mjs` | Connector 基类与统一事件格式 |
| `connectors/file-tail.mjs` | 通用文件尾随连接器（监听任意日志/会话文件） |
| `connectors/sqlite-poll.mjs` | SQLite 只增日志表轮询（Codex 等） |
| `connectors/json-store-poll.mjs` | JSON 状态文件轮询（Kimi 桌面端 kimi-agent stores） |
| `connectors/zstd-jsonl-poll.mjs` | Zstd 压缩 JSONL 会话轮询（DeepSeek Harness `~/.dsh/sessions`） |
| `connectors/process-watch.mjs` | 桌面端进程守护（Gemini / ChatGPT / DSH 状态变化） |
| `web/index.html` | 壁纸可视化页（思考粒子海） |
| `docs/ARCHITECTURE.md` | 架构与事件协议详细说明 |

## 本机已接入

| 来源 | 数据通道 | 事件 |
|---|---|---|
| Codex | `~/.codex/logs_2.sqlite` 轮询 | 工具调用 / 报错 / 推理 |
| Kimi 桌面端 | `kimi-agent` JSON stores 轮询 | token 用量 / 会话状态 / 文件编辑 |
| DeepSeek Harness | `~/.dsh/sessions/*.jsonl.zstd` 解码 + 进程守护 | 会话事件 / 运行状态 |
| Gemini 桌面版 | 进程守护（数据不落盘文本日志） | 启动 / 退出 |
| ChatGPT 桌面版 | 进程守护（启动即自动接管） | 启动 / 退出 |

## 路线图

- [ ] Claude Code 会话连接器（`~/.claude/projects/**/jsonl`，装上加即生效）
- [ ] ChatGPT 桌面版 UI Automation 深度状态
- [ ] 面板 HUD：当前任务、今日 token、事件速率、工具分布
- [ ] 用量账本（读本地 cost 记录）
- [ ] 自动选屏与开机自启脚本（launchd）
- [ ] 演示录制脚本

## 许可

MIT（见 LICENSE）。本项目为个人非商业学习项目。
