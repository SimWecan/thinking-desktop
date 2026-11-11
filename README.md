# Thinking Desktop

把本机所有大模型桌面端软件的「思考过程」具像化为一张实时桌面壁纸。

当任何一个 AI 助手正在推理、调用工具、输出内容时，壁纸随之流动、发光、加速；
全部空闲时，画面进入慢速待命的呼吸状态。灵感与架构参考 [dsh-hud-haloflux](https://github.com/ACyCar1o/dsh-hud-haloflux)（DSH × HALOFLUX），但本仓库为独立原创实现。

## 特性

- **双形态壁纸**：
  - **待机** — HALOFLUX **环带停止转动**：环内网纹与环带本体保留原地定格（环上留着最后一次截流文本），环内外的粒子特效（流光、彗星、光斑、远景粒子）全部消失。采用按需渲染：退出 rAF 循环，由文本/尺寸变化事件直接触发重绘（WKWebView 被窗口遮挡时 rAF 会被系统完全节流）；重建画布后自动补帧，不会再黑屏
  - **思考** — 检测到 agent 开始工作：环带恢复转动、粒子特效重新出现（rAF 循环重启），**环带数据块实时换成最新截流文本**（0.3s 刷新，版式稳定不重排），AI 活动越剧烈只是轻微加快；全部空闲 20 秒后环带停止进入待机（`status` 不算工作；回合结束立即解除宽限）
- **固定机位**：关闭 HALOFLUX 的自动运镜（原先会在几个机位间推近/拉远做「特写」），画面永远保持 z=1 的固定构图；节奏/转速/辉光也压在小幅区间，长时间运行不刺眼、不发疯
- **悬停出窗**：鼠标停在**环带上**才弹出右侧截流视窗（白框透明底白字、从光环向右滑入，每行标注来源），移开即收起；不做任何悬停放大/特写。点击穿透仍由原生宿主全局转发，点桌面任意位置都会激起冲击波。浏览器预览 `http://127.0.0.1:7799` 原生生效；预览可用 `?force=idle` / `?force=active` 强制指定形态
- **真实数据优先**：`npm run backfill` 从今天的真实会话里按来源配额 + 等距取样回填（DSH 的 reasoning、Kimi 的 think/output），通过 `POST /texts` 原子替换服务端缓冲，避免模拟数据残留；工具/上下文统计只来自真实事件
- **思考日志上墙（启动即回填）**：`/texts` 会保留最近的思考文本，壁纸一启动就把环带和视窗填满（不用等下一次事件）。环带用角度把最近的文本切成互不相同的片段铺进各个数据块（不会整圈重复同一段），6.4px 字号可读。内容直接来自开源模型落盘的**真实思考日志**（DeepSeek Harness 会话里的 `reasoning`、Kimi wire 里的 `think` 片段），整段不截句——环带数据块实时铺最新内容，右侧视窗按原文（保留换行）完整展示，每行标注来源；只保留最近 60 段、单段上限 6000 字，避免无限膨胀。闭源 AI 无本地日志时环带退回预设动画
- **右侧实时看板**：鼠标停在环带上展开——60s 总速率曲线（面积渐变 + 末点）、EVENTS/TOOLS/AGENTS 统计、**每个 agent 自己的 60s 迷你曲线** + 专属色 + 累计事件 + 最后活跃时间、工具调用分布、**CONTEXT 段逐 agent 的上下文占用**（DSH 用 usage 的 input+cacheRead / contextWindow，Kimi 用 maxUsage）、以及逐行标注来源的思考流；右上角另有常驻迷你曲线与活跃厂商色点，不悬停也能看到节奏
- **停环判定**：任一来源 **20s** 内没有真实工作事件（`status` 不计）→ 环带停转；`turn/end` 会立刻解除忙碌宽限。闭源端（Gemini/ChatGPT）的 CPU 活动检测带**空闲基线 + 滞后**（进入 ≥ max(14%, 基线+8) 且连续 2 次，退出跌破 max(7%, 基线+4) 连续 3 次），避免它们自身的轻微 CPU 抖动反复把壁纸唤醒
- **切换平滑**：多厂商并行时，新来源 0.6s 淡入、退出时约 2-4s 渐隐；环带分道位置随在场数量平滑滑动（1 个居中 → 2 个 1/3、2/3 → …），整帧主色按帧插值过渡，不会硬切；进入待机时清掉光效层，避免半透明光斑冻在冻结帧上
- **多厂商光效**：每个厂商一个专属色——DeepSeek 深蓝 `#1E3A8A`、Kimi 白 `#FFFFFF`、Gemini 蓝紫 `#7C6BF2`、ChatGPT / Codex 紫 `#8B5CF6`。谁在跑（12s 内有真实工作事件，只有「开着」不算）就把**整个画面**按它的颜色染色（canvas `color` 混合，只改色相/饱和度、保留亮度）：环内外粒子、彗星、网纹、光束、环带一起变色。多厂商并行时按强度加权混色，同时各占一条环带通道做分道辉光 + 彩色粒子
- **多源接入（每个都真接到数据）**：统一抽象 Connector，本机四个 AI 桌面端全部接入——DSH / Kimi 走会话文件真实文本，Gemini / ChatGPT 走「进程守护 + CPU 活动度」真实工作信号（它们不落盘任何对话文本，只能取强度，取不到文本）
- **事件驱动**：token/工具/状态事件 → 强度提升 + 涟漪；报错 → 泛红
- **同一商标合并**：ChatGPT 与 Codex 共用同一个 ChatGPT 商标——托盘只显示一个图标、看板只占一行（事件数相加），点它同时切换两个来源的形态
- **托盘图标 = 软件自己的商标图**：直接从本机已安装的 `.app` 里取官方图标（ICNS → PNG，缓存在 `data/icons/`，不入库、不随仓库分发），不再手绘近似图形。**商标图本身完全不动**（不旋转、不缩放、不调色）；所有动效都画在它周围：呼吸光晕、虚线环自转、轨道点、扩散圈，按厂商给不同节奏。没有 `.app` 可取的厂商（例如只有 CLI 的 Codex）显示中性字母牌，可在 `config/icons.json` 里手动指定图标路径
- **托盘自适应**：浮窗高度随内容上报给宿主（`messageHandlers.tray`），收起时只有约 62px 高，不会再留一块透明区域挡住桌面点击
- **桌面软件化（agent 绑定 + 调色盘 + 托盘）**：
  - **绑定管理**：`http://127.0.0.1:7799/config.html` 配置页自动探测本机已装的 AI 桌面端（macOS 路径探测），逐个绑定/解绑；绑定后打通通道检测运行状态、拉取日志
  - **调色盘**：配置页选中任一已绑定 agent，弹出 12 色色板 + 自定义取色器，设定该 agent 运行时粒子特效/光效的专属颜色（持久化到 `config/agents.json`）
  - **右上角托盘**：壁纸运行时桌面右上角出现可展开图标条（透明悬浮，仅图标、无底色）；默认为**综合形态**（多 agent 并行时多粒子特效同时展示，任一 agent 思考时综合环加速旋转），点击展开为已绑定 agent 的图标——图标直接从本机安装的 .app 提取**官方商标图**（提取不到的显示字母牌，不伪造 logo）：空闲时灰化静止，思考时按厂商各自的动效运动（DeepSeek 漂浮、Kimi 上下浮动、Gemini 旋转闪烁、ChatGPT 呼吸、Claude 旋转、Codex 脉动）并点亮该厂商专属色的光晕
  - **单一/综合切换**：单击综合图标展开侧栏；点任意厂商图标即切换为该 agent 的单一粒子形态并**收回侧栏**；收回后综合按钮直接显示**当前选中的厂商图标**（全部形态时显示三环标记）；再点综合图标回到综合形态并收回（右键可只展开/收起）
- **Windows 原生宿主**：`win/` 提供 .NET 8 + WebView2 原生壁纸宿主（置底、点击穿透、托盘浮窗）与 `install.ps1` 自启安装脚本（⚠️ 代码已编写但未经 Windows 真机编译验证）
- **零第三方依赖**：服务端仅使用 Node.js 标准库（DSH 会话解码复用系统 `zstd` 命令）
- **可自检**：`npm run links` / `/health` 给出每个 AI 桌面端的连接通道、事件数、最后事件时间与闭源端实时 CPU，能直接区分「connector 注册了」和「connector 真的接到数据」
- **壁纸化**：macOS 原生桌面级 WebView 宿主（见下）；Windows 可用 Lively Wallpaper 加载 `/wall`
- **跨平台**：macOS / Windows / Linux 均可运行

## 闭源端真实文本（可选，需要辅助功能授权）

Gemini / ChatGPT 不落盘任何对话文本，默认只能取到「工作强度」（CPU）。想拿到真实文本：

1. 编译小工具：`macos/build-axread.sh`（`install.sh` 也会自动编译），产物在 `bin/axread`
2. 系统设置 → 隐私与安全性 → **辅助功能** → `+` → 选择 `bin/axread` 并勾选
3. 验证：`curl http://127.0.0.1:7799/ax` 应返回 `{"trusted":true,...}`（未授权时是 `false`，此时连接器会安静降级、只在日志里提示一次）
4. 重启服务：`launchctl kickstart -k gui/$UID/com.simwecan.thinking-desktop`

授权后每 2 秒读取一次前台窗口里新增的文本（最多 1200 字/条），与其它来源一样进环带/看板。

## 本机令牌

写状态的接口（`/ingest`、`/texts`、`/view`、`/ui`、`/stats`、`/snapshot`、`/debug`、`/selftest`）要求本机令牌：

- 页面访问时服务端会下发 `td_token` Cookie，浏览器/WebView 自动携带
- 脚本调用读 `data/.token`，放在 `x-td-token` 头里，例如：

```bash
TOKEN=$(cat data/.token)
curl -X POST -H "x-td-token: $TOKEN" http://127.0.0.1:7799/ingest -d '{"source":"kimi-desktop","type":"text","payload":{"text":"hello"}}'
```

## 配置（可选）

`config/ui.json` 覆盖界面行为，缺省即默认：

```json
{
  "ringText": "headline",   // headline=环带只铺每段首句；full=整段原文
  "panel": "hover",         // hover=鼠标停在环带上才展开看板；always=常驻
  "holdSec": 20,            // 多久没有工作事件就停环
  "lightsWindowSec": 12,    // 光源/粒子淡出窗口
  "ringChars": 90           // headline 模式每段最多多少字
}
```

改完刷新页面即生效（`/state.ui` 每秒下发）；也可以直接在 <http://127.0.0.1:7799/config> 的「界面行为」里改（写入同一个文件）。示例见 `config/ui.example.json`。

## 架构

```
各 AI 桌面端 (Claude Code / Codex / Kimi / ChatGPT …)
   │  日志文件 / 会话 jsonl / UI Automation
   ▼
connectors/            ← 每个 AI 软件一个适配器，产出统一事件
   │  { source, type: thought|tool_call|tool_result|error|token, ts, payload }
   ▼
server/index.mjs       ← 事件汇聚、速率统计、SSE 推送 (127.0.0.1:7799)
   │  GET /stream (SSE) · GET /state (JSON) · /agents /view（绑定与形态）
   ▼
server/agents.mjs      ← 厂商预设（名称/专属色/动态效果）+ 安装探测 + 注册表持久化
   ▼
web/index.html         ← Canvas 可视化（思考粒子海），壁纸引擎加载
web/config.html      ← 配置页：绑定管理 + 调色盘
web/tray.html        ← 右上角托盘：综合/单一形态切换 + 厂商动态图标
   ▼
Lively Wallpaper / Wallpaper Engine / 原生宿主（macOS .app、Windows win/）
```

## 快速开始

```bash
# 需要 Node.js 20+
node server/index.mjs          # 启动数据服务，监听 127.0.0.1:7799

# 浏览器打开 http://127.0.0.1:7799 预览效果（?debug=1 打开状态面板）

# 自检 / 测试
npm run simulate                        # 多 agent 并行模拟：注入多厂商事件 → 逐阶段截图 + 校验点亮来源
npm run simulate:transition             # 切换平滑度：两个厂商并行 → 停一个 → 校验渐隐与通道滑动
npm run backfill                        # 用「今天」的真实会话（DSH 会话 + Kimi wire）回填思考流，清掉演示/模拟数据
# 看板自检（无录屏权限也能看到真实渲染）：
curl -s 'http://127.0.0.1:7799/snapshot?request=1' >/dev/null; sleep 2
curl -s 'http://127.0.0.1:7799/snapshot?panel=1' -o /tmp/panel.png
npm run links                           # 每个 AI 桌面端：数据通道 / 事件数 / 最后事件 / 实时 CPU
curl -s http://127.0.0.1:7799/health    # 同上，原始 JSON（含 zstd 状态）
npm test                                # connector + 事件映射 + 活动度解析的单元测试
```

### macOS 一键安装（自启 + 桌面壁纸）

```bash
macos/install.sh
```

- 安装 launchd 服务 `com.simwecan.thinking-desktop`：登录自动启动数据服务，崩溃 10 秒后自动拉起
- 安装壁纸自启 `com.simwecan.thinking-desktop-wallpaper`：直接守护壁纸 App 进程本体，登录自动启动、崩溃 10 秒自愈（App 内有单实例守卫，手动 `open` 不会叠出第二层壁纸）
- 编译 `Thinking Desktop Wallpaper.app`：原生 WKWebView 桌面级壁纸宿主（桌面图标之下、全屏铺满、多屏自适应、插拔屏自动重建）
- 管理：`launchctl kickstart -k gui/$UID/com.simwecan.thinking-desktop`（重启服务）／`launchctl bootout gui/$UID/com.simwecan.thinking-desktop`（卸载自启）

### Windows

数据服务跨平台可用。两种方式任选：

- **原生宿主（推荐）**：`win/install.ps1` 自动安装 .NET 8 + WebView2 原生壁纸宿主（置底、点击穿透、右上角托盘浮窗），并注册任务计划程序实现登录自启（⚠️ 尚未经 Windows 真机验证）
- **Lively Wallpaper**：添加壁纸 → URL → `http://127.0.0.1:7799/wall`。

## 目录

| 路径 | 说明 |
|---|---|
| `server/index.mjs` | 数据服务：事件汇聚、速率统计、SSE / JSON API；按本机软件自动注册 connector |
| `connectors/base.mjs` | Connector 基类与统一事件格式 |
| `connectors/file-tail.mjs` | 通用文件尾随连接器（监听任意日志/会话文件） |
| `connectors/sqlite-poll.mjs` | SQLite 只增日志表轮询（Codex 等） |
| `connectors/json-store-poll.mjs` | JSON 状态文件轮询（Kimi 桌面端 kimi-agent stores） |
| `connectors/zstd-jsonl-poll.mjs` | Zstd 压缩 JSONL 会话轮询（DeepSeek Harness `~/.dsh/sessions`）：递归发现多层目录、同时跟踪多个活跃会话、按 size/mtime 增量解码、启动不回放历史 |
| `connectors/dsh-session.mjs` | DSH v4 会话行 → 统一事件：只上报真实的推理文本/工具调用/报错，忽略 title、request、job 等元数据行 |
| `connectors/process-watch.mjs` | 桌面端进程守护（Gemini / ChatGPT / DSH 状态变化） |
| `connectors/process-activity.mjs` | 闭源端真实活动度：`ps` 采样该 App 全部进程的 CPU，超过阈值即上报「正在工作」（Gemini / ChatGPT 没有本地文本，只能取强度） |
| `web/index.html` | 壁纸页（光环 iframe + 右侧发散文本视窗 + 状态 HUD + 综合/单一形态切换） |
| `server/agents.mjs` | 厂商预设注册表：7 个厂商的名称/简称/专属色/动态效果，macOS 安装路径探测，持久化到 `config/agents.json` |
| `web/config.html` | 配置页：agent 绑定开关 + 调色盘（12 色 + 自定义取色器） |
| `web/tray.html` | 右上角托盘页：综合形态环、厂商动态图标（透明悬浮）、单一形态切换 |
| `win/` | Windows 原生壁纸宿主（.NET 8 + WebView2）：置底点击穿透壁纸窗口 + 托盘浮窗 + 任务计划自启 |
| `scripts/links.mjs` | 连接自检 CLI（`npm run links`）：每个来源的通道 / 事件数 / 最后事件 / 实时 CPU |
| `scripts/simulate.mjs` | 多 agent 并行模拟（`npm run simulate`）：往 `/ingest` 注入多厂商思考事件，逐阶段请求画布快照并校验实际点亮的来源 |
| `docs/ARCHITECTURE.md` | 架构与事件协议详细说明 |
| `test/` | `node --test` 单元测试（connector 增量消费、事件映射） |

## 本机已接入

| 来源 | 数据通道 | 事件 |
|---|---|---|
| DeepSeek Harness | `~/.dsh/sessions/<workspace>/session-*/session.v4.jsonl.zstd` 解码 + 进程守护 | 推理文本 / 工具调用 / 结果 / 运行状态 |
| Kimi 桌面端 | 并行尾随**所有活跃** `wire.jsonl`（15 分钟窗口）+ `kimi-agent` JSON stores | 真实输出 / 截流摘要 / 工具调用 / token 与状态 |
| Gemini 桌面版 | 进程守护 + CPU 活动度（无本地文本通道） | 启动 / 退出 / **工作中（按 CPU）** |
| ChatGPT 桌面版 | 进程守护 + CPU 活动度（无本地文本通道） | 启动 / 退出 / **工作中（按 CPU）** |
| Codex | `~/.codex/logs_2.sqlite` 轮询 | 工具调用 / 报错 / 推理（CLI 未用时自然静默） |

## 路线图

- [ ] Claude Code 会话连接器（`~/.claude/projects/**/jsonl`，装上加即生效）
- [ ] 闭源端真实文本：GUI 端 Accessibility（AX）读屏方案（需授权辅助功能，作为可选增强）
- [x] 闭源端真实活动度（CPU 采样，Gemini / ChatGPT 已接入）
- [ ] 面板 HUD：当前任务、今日 token、事件速率、工具分布
- [ ] 用量账本（读本地 cost 记录）
- [x] 开机自启与崩溃自愈（launchd，`macos/install.sh`）
- [x] DSH 会话截流（多层目录 + 多会话并行 + 元数据行过滤）
- [x] 桌面软件化：agent 绑定注册表 + 配置页 + 调色盘 + 右上角托盘（综合/单一形态、厂商动态图标）
- [ ] Windows 原生宿主真机验证（`win/` 已编写）
- [ ] 演示录制脚本

## 维护说明

- 只有显式设置 `THINKING_DESKTOP_TAIL=<日志文件>` 时才会启用 `connectors/file-tail.mjs`（开发用通用尾随器）
- `win/` 只在 Windows 上使用，macOS 宿主不会加载
- 已注释保留的历史代码（不参与运行、留着备查）：`web/index.html` 的 `agentActivity` 与旧 `.ag .bar` 样式、`web/tray.html` 的 `SRC_NAME`/`iconUrl`

## 许可

- 本项目代码：MIT（见 LICENSE）
- `web/haloflux/`：思考形态使用的 **HALOFLUX by Ryder191 (RYDER CODE / Ms MAIKEBAIs CAT)**，[PolyForm Noncommercial License 1.0.0](https://github.com/Ryder191/haloflux)（仅限个人非商业用途，严禁商业使用）。仅追加 `td-bridge` 桥接脚本（事件驱动/去面板/静音/待机暂停），其余原样；画面右下角保留署名。分享本项目视频/截图时须注明 `HALOFLUX by Ryder191 - https://github.com/Ryder191/haloflux`。详见 `web/haloflux/NOTICE.md` 与 LICENSE。
