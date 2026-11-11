# 0.5.1 · 2026-11-11

- **新商标「神经光环」**：深空蓝黑底、24 格仪表刻度、蓝紫渐变主弧、虚线轨迹与轨道节点、
  环心思考波形与光核；矢量 SVG + 64/256/512/1024 PNG 全套重渲
- **图标实装**：两个 .app 都带 `AppIcon.icns`（16→1024 全尺寸），控制台/壁纸在 Dock 与 Finder 中显示新标
- 控制台、配置页头部与 favicon 同步新标

# 发版验收清单

每次发版前固定执行：

```bash
npm run release:check
```

`release:check` 会依次跑（任一失败即中止发版，退出码非 0）：

1. **单元测试** — `npm test`（`node --test`）：connector 增量消费、事件映射、
   活动度解析、DSH 会话、Kimi wire、UI 逻辑（winddownCalm）、配置兼容。
2. **端到端场景测试** — `scripts/e2e-test.mjs`：单 agent / 多 agent 并行 /
   综合↔单独形态切换（光环缓动落位）/ 动态静默（calm 曲线 → idle + rAF 退出）/
   活动回归。与真实数据三层隔离（连接器停用 + 统计不载入 + 备份还原），
   结束后自动恢复服务与壁纸。
3. **工作区检查** — 列出未提交改动（提醒，不阻断）。

## 人工过一遍（自动化覆盖不到的部分）

- [ ] 配置窗口（`/config`）走查：壁纸预览、各 agent 通道路径、调色盘改色、绑定开关
- [ ] 托盘走查：综合/单独形态切换、思考中动效、图层拆分（logo 静止 + 内容层动效）
- [ ] 壁纸实机流畅度：思考时帧率（遥测 `adaptCap`/`paints`）、动态静默过渡观感
- [ ] Windows 宿主改动了的话：在 Windows 上过一遍安装与自启（本机无 Windows，属跨平台风险项）

## 发版动作

1. 更新 `package.json` version 与 macOS plist 的 `CFBundleVersion`。
2. `npm run release:check` 全绿。
3. 提交 → `git tag v<版本>` → `git push && git push --tags`。
4. GitHub Release 写明：新增 / 修复 / 配置项变化（尤其 `ui.json` 字段）。

---

# v0.5.0 变更说明（2026-11-11）

## 新功能

- **双击控制台应用（macOS）**：`Thinking Desktop.app` 双击弹出控制台窗口——运行状态、AI 桌面端通道、实时日志、重启服务/壁纸、完整配置入口；关窗即退出（TerraFin 黑白风格）
- **DeepSeek 商标动画重做**：鲸鱼完整「跃出商标框 → 空中翻身 → 扎回隐没 → 从商标中浮现」周期（3.4s）；glyph 内容层移到 logoWrap 外，框外动作不再被裁剪；底层商标图保持静止

## 交互优化

- 环带悬停命中加入迟滞：进入需压进 6px、离开需退出 10px，缘线上不再来回抖动
- 鼠标采样 50ms → 25ms，悬停响应压到一帧以内
- 悬停环带时光标变手型（Finder 会重置光标，宿主随采样常驻维持）
- 光环缘线悬停增亮（hoverBoost 平滑过渡）
- 右侧截流视窗滑入提速：0.55s → 0.34s

## 性能优化

- 光环环槽数据块重排概率 0.02 → 0.012（每帧最贵的文字排版分配减半，视觉无感）
- 托盘动效自检遥测降频至每 3 轮一次（getComputedStyle 强制样式重算）
- 壁纸双实例治理：PID 锁文件单实例守卫（launchd 直启时 NSRunningApplication 不可靠）

## 修复

- `/version` 引用未定义常量：任何页面请求即整服务崩溃（exit 1）
- SSE 重连 / iframe 加载后光环来源残影（ghost sources 永不清除）
- 桌面层级托盘收不到任何鼠标事件：改普通层级 + Finder 前台联动显隐
- 悬停变量作用域错配导致粒子特效冻结（drawRing 每帧 ReferenceError 打断 rAF）

## 质量

- e2e 新增 P0 基础设施回归（/version、/logs、/console）与 waitWall 轮询助手，P4 静默观测起点确定性重置
- 单元 48/48，e2e 22/22，release:check 全绿
