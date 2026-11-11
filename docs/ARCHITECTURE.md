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

## 前端结构（v2 目标，分切片落地）

```
web/
  wall/        壁纸宿主页：index.html + app/（SSE 客户端、右侧面板、光环桥接）
  halo/        光环渲染器：js/ 按场景模块拆分（config/ring/slots/lights/texts/particles/ripple/standby/adaptive/bridge）
  tray/        托盘：index.html + tray.css + tray.js + glyphs.js
  ui/          TerraFin 设计系统：terafin.css（config/console 共用，消除两份重复样式）
  lib/         纯函数共享逻辑（td-logic.js 风洞曲线等，服务端测试可直接引用）
```

## 硬约束（任何改动不得破坏）

1. **安全**：监听仅 127.0.0.1；Host 必须回环；写接口要令牌（Cookie / `x-td-token`）；
   SSE 与 JSON 一律不加 CORS 头（事件流里有本机 AI 真实思考文本）。
2. **零依赖**：服务端只准用 Node 标准库。
3. **测试隔离**：`THINKING_DESKTOP_CONNECTORS=off` 必须切断全部真实连接器；
   `POST /ingest?test=1` 的事件在暂停期间仍放行（e2e 依赖）。
4. **契约**：`/state`、`/stream` 消息形状、`/debug` 遥测字段、页面别名（/tray /config /console /wall）
   保持兼容——e2e 与两个原生宿主是这些契约的活测试。
