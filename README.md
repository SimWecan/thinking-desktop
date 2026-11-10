# Thinking Desktop

把本机所有大模型桌面端软件的「思考过程」具像化为一张实时桌面壁纸。

当任何一个 AI 助手正在推理、调用工具、输出内容时，壁纸随之流动、发光、加速；
全部空闲时，画面进入慢速待命的呼吸状态。灵感与架构参考 [dsh-hud-haloflux](https://github.com/ACyCar1o/dsh-hud-haloflux)（DSH × HALOFLUX），但本仓库为独立原创实现。

## 特性

- **双形态壁纸**：
  - **待机** — 自绘粒子从屏幕边缘向中心螺旋汇聚、被核心吸收，缓慢呼吸
  - **思考** — 切换为 [HALOFLUX](https://github.com/Ryder191/haloflux) 光环本体（客制化：隐藏全部 HUD 面板小窗口与进度条、静音、右下角署名保留），AI 活动越剧烈节拍越快、光束越亮；全部空闲 30 秒后切回待机
- **交互**（浏览器预览 `http://127.0.0.1:7799` 中生效）：移动鼠标推开粒子；点击产生冲击波。桌面壁纸为不遮挡图标而点击穿透，交互仅在预览页可用
- **多源接入**：统一抽象 Connector，接入 Codex / Kimi / DeepSeek Harness / Gemini / ChatGPT 桌面端等本机 AI 软件的事件流
- **事件驱动**：token/工具/状态事件 → 强度提升 + 涟漪；报错 → 泛红
- **零第三方依赖**：服务端仅使用 Node.js 标准库
- **壁纸化**：macOS 原生桌面级 WebView 宿主（见下）；Windows 可用 Lively Wallpaper 加载 `/wall`
- **跨平台**：macOS / Windows / Linux 均可运行

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
```

### macOS 一键安装（自启 + 桌面壁纸）

```bash
macos/install.sh
```

- 安装 launchd 服务 `com.simwecan.thinking-desktop`：登录自动启动数据服务，崩溃 10 秒后自动拉起
- 编译 `Thinking Desktop Wallpaper.app`：原生 WKWebView 桌面级壁纸宿主（桌面图标之下、全屏铺满、多屏自适应、插拔屏自动重建）
- 管理：`launchctl kickstart -k gui/$UID/com.simwecan.thinking-desktop`（重启服务）／`launchctl bootout gui/$UID/com.simwecan.thinking-desktop`（卸载自启）

### Windows

数据服务跨平台可用；壁纸层用 Lively Wallpaper：添加壁纸 → URL → `http://127.0.0.1:7799/wall`。

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

- 本项目代码：MIT（见 LICENSE）
- `web/haloflux/`：思考形态使用的 **HALOFLUX by Ryder191 (RYDER CODE / Ms MAIKEBAIs CAT)**，[PolyForm Noncommercial License 1.0.0](https://github.com/Ryder191/haloflux)（仅限个人非商业用途，严禁商业使用）。仅追加 `td-bridge` 桥接脚本（事件驱动/去面板/静音/待机暂停），其余原样；画面右下角保留署名。分享本项目视频/截图时须注明 `HALOFLUX by Ryder191 - https://github.com/Ryder191/haloflux`。详见 `web/haloflux/NOTICE.md` 与 LICENSE。
