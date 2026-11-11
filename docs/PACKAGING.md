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
