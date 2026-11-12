# 安装包构建

```bash
npm run build:pkg     # macOS：dist/Thinking-Desktop-<版本>-macos.pkg（未签名，本机/开发分发）
npm run build:win     # Windows：dist/Thinking-Desktop-<版本>-win.zip（源码包，解压后跑 install.ps1）
```

## macOS（.pkg）

`pkgbuild` 组装：项目本体 + 已编译壁纸宿主 → `/Applications/Thinking Desktop/`，
postinstall 把属主交给控制台用户、写 LaunchAgents、启动数据服务与壁纸。
未签名——双击 pkg 会被 Gatekeeper 拦，右键「打开」即可；或
`sudo installer -pkg dist/...pkg -target /`。
要正式分发需 Apple Developer 签名 + notarize（`scripts/build-pkg.sh` 里加
`--sign "Developer ID Installer: ..."` 并跑 `xcrun notarytool`）。

## Windows（.zip + Inno Setup 脚本）

本机（macOS）没有 .NET/NSIS 工具链，产物是**源码安装包**：解压后
`powershell -NoProfile -ExecutionPolicy Bypass -File win\install.ps1`
（前置 Node.js 20+、.NET 8 SDK、WebView2 Runtime；装完自动注册任务计划自启并启动壁纸）。

要真正的 Setup.exe：把 `dist-src/` 内容（build-win.ps1 产出）与 `win/installer.iss`
拿到 Windows 机器，装 Inno Setup 后 `iscc win\installer.iss` 即可，
脚本已写好安装/卸载/开始菜单全套。

## dist/ 说明

安装包不进 git（`dist/` 在 .gitignore）；发版时作为 GitHub Release 附件上传。

## 在线安装 / 下载页产物

「一句话安装」需要把下面这些文件放在**同一个下载目录**（GitHub Release、对象存储、任意静态站点）：

| 文件 | 来源 | 用途 |
|---|---|---|
| `install-online.sh` | `scripts/install-online.sh` | macOS 在线安装（用户级，无需 sudo） |
| `install-online.ps1` | `scripts/install-online.ps1` | Windows 在线安装 |
| `Thinking-Desktop-macos.tar.gz` + `.sha256` | `npm run build:portable` | macOS 便携包（固定名，供脚本按 URL 拉取） |
| `Thinking-Desktop-win.zip` + `.sha256` | `npm run build:win` | Windows 源码包（固定名） |
| `Thinking-Desktop-<版本>-macos.pkg` | `npm run build:pkg` | 可选：管理员手动安装 |

下载页是 `web/download.html`（应用内 `/download`，也可单独托管）：

- 顶部 `ASSET_BASE` 改成实际下载目录；`RELEASES_PAGE` 改成版本页
- 页面会自动生成「复制给 AI 的指令」，macOS / Windows 两个分支都在里面
- 自托管时把 `install-online.*`、`Thinking-Desktop-macos.tar.gz`、`Thinking-Desktop-win.zip`
  和两个 `.sha256` 一起上传即可

安装脚本的行为（幂等）：

1. macOS 检查 Node.js 20+（缺则 `brew install node`）；Windows 检查 Node.js + .NET 8 SDK（缺则 winget）
2. 下载安装包并校验 sha256（有 `.sha256` 时）
3. 解压到用户目录，写两个 LaunchAgent（macOS）/ 计划任务（Windows）并启动
4. 等 `/health` 就绪，读 `/agents`，把 `installed` 的来源逐个 `enabled=true`，切 `view=all`
5. 打开控制台（macOS 启动 `Thinking Desktop.app`；Windows 打开 `/console`）

发布时建议先 `npm test`、`npm run build:pkg`、`npm run build:portable`、`npm run build:win`，
再把上表文件上传到同一个目录，最后用一个干净的用户账号跑一遍 `install-online.sh` 验收。

### 自动化发布

仓库内 `.github/workflows/release.yml`：push 形如 `v0.8.0` 的 tag 时，在 macOS runner 上
按顺序跑单测 → `build-pkg` → `build-portable` → `build-win`，把上表所有产物（含
`install-online.sh/.ps1` 与两个 `.sha256`）挂到该 Release。`releases/latest/download/<固定名>`
正好就是下载页 `ASSET_BASE` 的默认值，发布后无需再改页面。
