# Windows 宿主（未在真机验证）

`ThinkingDesktopWallpaper` 是 .NET 8 + WebView2 的原生宿主：壁纸窗口置底 + 点击穿透，右上角托盘浮窗加载 `/tray.html`。

## 安装

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File win\install.ps1
```

前置：Node.js 20+、.NET 8 SDK、WebView2 Runtime（Win11 自带）。

## 已知限制 / 验证清单

下面这些还需要在 Windows 真机上确认（本仓库作者只有 macOS）：

- [ ] `dotnet build` 能通过（`Microsoft.Web.WebView2` 包还原需要网络）
- [ ] 壁纸窗口位于桌面图标之下、不抢焦点、点击可穿透到桌面
- [ ] 托盘浮窗背景真正透明（用 `TransparencyKey` = 洋红实现，图标里的黑色不会被抠掉）
- [ ] 托盘展开/收起时窗口高度跟随（页面 `chrome.webview.postMessage({height})`）
- [x] 多显示器：按 `Screen.AllScreens` 每块屏各建一个壁纸窗口（已实现，未真机验证；插拔/分辨率变化需重启宿主）
- [ ] 任务计划程序自启 + 崩溃重启（脚本已设 `RestartCount 999 / 每分钟`）
- [ ] 高 DPI 缩放下的坐标与尺寸（app.manifest 已声明 PerMonitorV2）

## 数据服务

Windows 上同样只需要 `node server/index.mjs`；DSH 会话解码需要系统里有 `zstd`（可用 `winget install zstd` 或 Chocolatey），缺失时服务会告警并跳过 DSH 文本。
