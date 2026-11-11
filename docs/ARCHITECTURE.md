# Thinking Desktop 架构（v2，2026-11 重写）

> 目标：底层健壮、模块化、规范化；消灭巨型文件与散装重复；每一层只依赖下一层。
> 前端效果与 HTTP 契约对 v1 保持完全兼容（壁纸/托盘/配置页/e2e 无感切换）。

## 分层与依赖方向

```
hosts/mac, hosts/win          原生宿主（壁纸窗口 / 托盘 / 控制台 / axread）
        │  HTTP + SSE
        ▼
server/routes/*    ← 唯一接触 HTTP 的层；每个域名一个模块，只声明「路径 → 处理」
        │  调用
        ▼
server/core/*      store（状态+持久化）· stream-hub（SSE）· security（令牌/源校验）· http（路由器）
        ▲  被装配
server/app.mjs     组合根：创建 core → 装配 connectors → 注册 routes → listen
server/index.mjs   入口：读环境变量 → app.start()（<20 行，不含任何业务）
```

依赖只允许向下；`core` 不知道 HTTP 存在（`pushEvent` 通过注入的监听器外发），
`routes` 之间不互相 import，共享状态一律经组合根注入的 `ctx`。

## 模块契约

| 模块 | 职责 | 不做什么 |
|---|---|---|
| `core/store.mjs` | 事件入栈、速率/来源/工具/token 统计、文本 backlog、今日统计落盘、快照缓冲、`state()` 派生 | 不做任何网络 I/O |
| `core/stream-hub.mjs` | SSE 客户端集：hello / broadcast / 心跳清理死连接 | 不构造事件 payload |
| `core/security.mjs` | 令牌签发与校验、Host 头（防 DNS rebinding）/Origin 校验、写接口判定 | 不读请求体 |
| `core/http.mjs` | 微型路由器（method + 精确路径 + 前缀通配）、JSON 体读取 | 不含任何业务路由 |
| `routes/*.mjs` | 一个域名一组端点（agents/debug/ingest/pages/snapshot/state/stream/system/test/texts/ui） | 不持有可变状态 |
| `connectors.mjs` | 按本机安装情况装配 connector 列表（替代 v1 在 index 里的 6 段散装注册） | 连接器实现仍在 `connectors/` |

## 前端结构（v2，已落地）

```
web/
  index.html         壁纸宿主页外壳（style + DOM + 脚本引用，165 行）
  wall/              壁纸编排层（经典脚本，共享全局作用域，按加载顺序）
    text.js          思考文本缓冲、上环扁平化、滚动区渲染（81 行）
    panel.js         右侧看板：曲线/agent/工具/上下文/迷你仪表 + 截图自检（217 行）
    main.js          halo iframe 接线、待机·动态静默、SSE、1s 主循环、调试 HUD（384 行）
  haloflux/          光环渲染器（上游 HALOFLUX 个人非商业二创，许可声明保留）
    index.html       外壳：核心 CSS + stage DOM（46 行）
    halo.js          光环本体：环带/网格/粒子/彗尾/节拍/自适应分辨率（1237 行）
    td-bridge.js     TD 客制化桥：待机全停/动态静默/文本上环/多厂商光源/冲击波/悬停（566 行）
    wp.js            Wallpaper Engine 兼容 shim（上游原样）
  tray.html          托盘外壳（透明悬浮样式 + DOM，216 行）
  tray/              托盘脚本
    icons.js         厂商商标 + 内容层动效构建（鲸鱼腾跃/流星/四芒星…）（114 行）
    main.js          形态切换 / 宿主高度上报 / 自检截图 / 1.5s 轮询（141 行）
  config.html        配置页（外壳 + 页面级样式）
  console.html       控制台窗口（外壳 + 页面级样式）
  ui/terafin.css     TerraFin 黑白设计系统：色卡 + .svc/.ver/h2.sec/.btn 窗口件
  lib/               纯函数共享逻辑（td-logic.js 风洞曲线 / panel.js 曲线绘制），服务端测试可直接引用
  icon/              软件商标 + 厂商商标缓存回退
```

前端模块化约定：
- 外壳只留 style + DOM + `<script src>`；业务脚本一律外置。
- 页面脚本按经典脚本加载（非 ES module），顶层 `let/const/function` 跨脚本共享——
  加载顺序即依赖顺序（lib → 页面模块 → main），函数体内引用运行时解析。
- `__DEBUG__` 只由服务端在 `/wall` HTML 里替换；外部 js 经外壳内联脚本透传
  `window.__TD_DEBUG__`。
- 页面差异样式（尺寸/间距）通过 CSS 变量覆盖，共享样式只有 `ui/terafin.css` 一份。

## 硬约束（任何改动不得破坏）

1. **安全**：监听仅 127.0.0.1；Host 必须回环；写接口要令牌（Cookie / `x-td-token`）；
   SSE 与 JSON 一律不加 CORS 头（事件流里有本机 AI 真实思考文本）。
2. **零依赖**：服务端只准用 Node 标准库。
3. **测试隔离**：`THINKING_DESKTOP_CONNECTORS=off` 必须切断全部真实连接器；
   `POST /ingest?test=1` 的事件在暂停期间仍放行（e2e 依赖）。
4. **契约**：`/state`、`/stream` 消息形状、`/debug` 遥测字段、页面别名（/tray /config /console /wall）
   保持兼容——e2e 与两个原生宿主是这些契约的活测试。
