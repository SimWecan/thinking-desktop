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
