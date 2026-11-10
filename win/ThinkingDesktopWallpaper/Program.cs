// Thinking Desktop — Windows 宿主
// 壁纸窗口：WebView2 加载 /wall，置于桌面图标下层（HWND_BOTTOM）、点击穿透；
// 托盘窗口：右上角可展开浮窗加载 /tray，接收点击。
// 数据服务（node server）需先启动：install.ps1 会配置登录自启。

using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.WinForms;

const string SERVER = "http://127.0.0.1:7799";

ApplicationConfiguration.Initialize();

// ---------- 壁纸窗口：点击穿透 + 置底 ----------
class WallForm : Form
{
    const int WS_EX_TOOLWINDOW = 0x80, WS_EX_LAYERED = 0x80000, WS_EX_TRANSPARENT = 0x20;
    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= WS_EX_TOOLWINDOW | WS_EX_LAYERED | WS_EX_TRANSPARENT;
            return cp;
        }
    }
}

// 托盘窗口：TOOLWINDOW 样式——不出现在 Alt-Tab / 任务切换里
class TrayForm : Form
{
    const int WS_EX_TOOLWINDOW = 0x80;
    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= WS_EX_TOOLWINDOW;
            return cp;
        }
    }
}

// 每块屏幕一个壁纸窗口（与 macOS 宿主对齐）
var walls = new List<WallForm>();
foreach (var screen in Screen.AllScreens)
{
    var w = new WallForm
    {
        FormBorderStyle = FormBorderStyle.None,
        StartPosition = FormStartPosition.Manual,
        Bounds = screen.Bounds,
        ShowInTaskbar = false,
        TopMost = false,
    };
    var v = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Black };
    w.Controls.Add(v);
    w.Load += async (_, _) =>
    {
        await v.EnsureCoreWebView2Async();
        v.CoreWebView2.Navigate($"{SERVER}/wall");
        Win32.ToBottom(w.Handle);
    };
    w.Show();
    walls.Add(w);
}

// ---------- 右上角托盘窗口 ----------
// 透明键用洋红：托盘页的图标里本来就有黑色（Kimi/ChatGPT 的商标），用黑色当透明键会把图标抠出洞
var KEY = Color.Magenta;
var tray = new TrayForm
{
    FormBorderStyle = FormBorderStyle.None,
    StartPosition = FormStartPosition.Manual,
    Bounds = new Rectangle(
        Screen.PrimaryScreen.WorkingArea.Right - 64 - 10,
        Screen.PrimaryScreen.WorkingArea.Top + 8,
        64, 62),                      // 收起态高度；展开时由页面 postMessage 上报
    ShowInTaskbar = false,
    TopMost = true,
    BackColor = KEY,
    TransparencyKey = KEY,
};
var trayView = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = KEY };
tray.Controls.Add(trayView);
tray.Load += async (_, _) =>
{
    await trayView.EnsureCoreWebView2Async();
    // 页面通过 chrome.webview.postMessage({height}) 上报内容高度，窗口跟着伸缩
    trayView.CoreWebView2.WebMessageReceived += (_, e) =>
    {
        try
        {
            var json = e.TryGetWebMessageAsString();
            if (string.IsNullOrWhiteSpace(json)) json = e.WebMessageAsJson;
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("height", out var h) && h.TryGetDouble(out var height))
            {
                var wa = Screen.FromControl(tray).WorkingArea;
                var newH = Math.Max(52, Math.Min(640, (int)Math.Round(height)));
                tray.Bounds = new Rectangle(wa.Right - tray.Width - 10, wa.Top + 8, tray.Width, newH);
            }
        }
        catch { /* 忽略坏消息 */ }
    };
    trayView.CoreWebView2.Navigate($"{SERVER}/tray.html");
};

// 保活：壁纸周期性拉回桌面层（被其它程序压底时恢复）
var keep = new System.Windows.Forms.Timer { Interval = 5000 };
keep.Tick += (_, _) => { foreach (var w in walls) if (!w.IsDisposed) Win32.ToBottom(w.Handle); };
keep.Start();

tray.Show();
Application.Run();

static class Win32
{
    public static readonly IntPtr HWND_BOTTOM = new(1);
    const uint SWP_NOMOVE = 0x2, SWP_NOSIZE = 0x1, SWP_NOACTIVATE = 0x10;
    [DllImport("user32.dll")]
    static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    public static void ToBottom(IntPtr handle) =>
        SetWindowPos(handle, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
}
