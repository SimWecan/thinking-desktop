; Thinking Desktop — Inno Setup 安装脚本
; 在 Windows 上安装 Inno Setup (https://jrsoftware.org/isdl.php) 后编译本文件，
; 生成 Thinking-Desktop-Setup.exe：安装项目到 Program Files、注册数据服务自启、
; 编译并启动壁纸宿主（需要 Node.js 20+ 与 .NET 8 SDK，装完会提示）。
;
; 前置：先把下列文件放进与 .iss 同级的 dist-src/ 目录（build-win.ps1 或手工打包）：
;   server/ web/ config/ win/ package.json README.md RELEASE.md
; 然后 ISCC 编译： iscc win\installer.iss

#define MyAppName "Thinking Desktop"
#define MyAppVersion "0.4.0"
#define MyAppPublisher "SimWecan"
#define MyAppURL "https://github.com/SimWecan/thinking-desktop"

[Setup]
AppId={{B7C1D2E3-4F5A-6B7C-8D9E-0F1A2B3C4D5E}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\Thinking Desktop
DefaultGroupName=Thinking Desktop
OutputBaseFilename=Thinking-Desktop-{#MyAppVersion}-Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64 arm64
ArchitecturesInstallIn64BitMode=x64 arm64

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "dist-src\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs

[Run]
; 数据服务注册登录自启 + 编译启动壁纸宿主（install.ps1 内含逐项检查与清晰报错）
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\win\install.ps1"""; Description: "注册服务并启动壁纸"; Flags: postinstall waituntilterminated

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Unregister-ScheduledTask -TaskName 'ThinkingDesktopServer' -Confirm:$false -ErrorAction SilentlyContinue; Get-Process ThinkingDesktopWallpaper -ErrorAction SilentlyContinue | Stop-Process -Force"""; Flags: runhidden

[Icons]
Name: "{group}\配置页"; Filename: "http://127.0.0.1:7799/config"
Name: "{group}\卸载"; Filename: "{uninstallexe}"
