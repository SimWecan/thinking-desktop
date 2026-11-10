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

var wall = new WallForm
{
    FormBorderStyle = FormBorderStyle.None,
    StartPosition = FormStartPosition.Manual,
    Bounds = Screen.PrimaryScreen.Bounds,
    ShowInTaskbar = false,
    TopMost = false,
};
var wallView = new WebView2 { Dock = DockStyle.Fill };
wall.Controls.Add(wallView);
wall.Load += async (_, _) =>
{
    await wallView.EnsureCoreWebView2Async();
    wallView.CoreWebView2.Navigate($"{SERVER}/wall");
    Win32.ToBottom(wall.Handle);
};

// ---------- 右上角托盘窗口 ----------
var tray = new Form
{
    FormBorderStyle = FormBorderStyle.None,
    StartPosition = FormStartPosition.Manual,
    Bounds = new Rectangle(
        Screen.PrimaryScreen.WorkingArea.Right - 64 - 10,
        Screen.PrimaryScreen.WorkingArea.Top + 8,
        64, 420),
    ShowInTaskbar = false,
    TopMost = true,
    BackColor = Color.Black,
    TransparencyKey = Color.Black,
};
var trayView = new WebView2 { Dock = DockStyle.Fill };
tray.Controls.Add(trayView);
tray.Load += async (_, _) =>
{
    await trayView.EnsureCoreWebView2Async();
    trayView.CoreWebView2.Navigate($"{SERVER}/tray");
};

// 保活：壁纸周期性拉回桌面层（被其它程序压底时恢复）
var keep = new System.Windows.Forms.Timer { Interval = 5000 };
keep.Tick += (_, _) => { if (!wall.IsDisposed) Win32.ToBottom(wall.Handle); };
keep.Start();

wall.Show();
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
