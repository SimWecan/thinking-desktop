/**
 * Thinking Desktop — macOS 桌面壁纸宿主
 * 把壁纸页 (http://127.0.0.1:7799/wall) 以桌面窗口层级（desktopWindow level）
 * 铺在所有屏幕上：位于桌面图标之后、不抢焦点、不接收鼠标事件。
 * 用法：由 build-wallpaper.sh 编译为 .app 后 open 启动。
 */

import Cocoa
import WebKit

let WALL_URL = "http://127.0.0.1:7799/wall"

// 单实例守卫：launchd KeepAlive 与手动 open 可能并存，重复实例会叠两层壁纸窗口
if NSRunningApplication.runningApplications(withBundleIdentifier: "com.simwecan.thinking-desktop-wallpaper").count > 1 {
    exit(0)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory) // 无 Dock 图标，不占焦点

final class WallpaperWindow: NSWindow {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

final class WallpaperView: NSView {
    private var webView: WKWebView?

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        guard webView == nil else { return }
        let config = WKWebViewConfiguration()
        let wv = WKWebView(frame: bounds, configuration: config)
        wv.autoresizingMask = [.width, .height]
        // 常驻壁纸页：强制绕过本地缓存，改完前端重启宿主即生效
        let req = URLRequest(
            url: URL(string: WALL_URL)!,
            cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
            timeoutInterval: 30)
        wv.load(req)
        addSubview(wv)
        webView = wv
    }

    /// 全局鼠标转发：壁纸窗口点击穿透收不到 move，靠全局监听换算成页面坐标（仅用于「是否停在环带上」）
    func forwardMouse(x: CGFloat, y: CGFloat) {
        webView?.evaluateJavaScript("window.__tdMouse(\(x),\(y))") { _, _ in }
    }

    /// 全局点击转发：待机圆环的冲击波互动（点击穿透下唯一的点击来源）
    func forwardClick(x: CGFloat, y: CGFloat) {
        webView?.evaluateJavaScript("window.__tdClick(\(x),\(y))") { _, _ in }
    }
}

private func makeWindow(on screen: NSScreen) -> WallpaperWindow {
    let frame = screen.frame
    let win = WallpaperWindow(
        contentRect: frame,
        styleMask: [.borderless],
        backing: .buffered,
        defer: false,
        screen: screen)
    // 桌面窗口层级：显示在桌面图标之下，Finder 切壁纸也不受影响
    win.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
    win.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
    win.backgroundColor = .clear
    win.isOpaque = false
    win.hasShadow = false
    win.ignoresMouseEvents = true // 点击穿透到桌面图标
    win.contentView = WallpaperView(frame: frame)
    win.orderBack(nil)
    return win
}

// 启动时铺满所有屏幕；新增显示器由 .canJoinAllSpaces 尽量跟随系统布局
var windows: [WallpaperWindow] = []
for screen in NSScreen.screens {
    windows.append(makeWindow(on: screen))
}

// 屏幕插拔时重建窗口
final class ScreenWatcher: NSObject {
    @objc func screensChanged(_ n: Notification) {
        windows.forEach { $0.orderOut(nil) }
        windows = NSScreen.screens.map(makeWindow)
        DispatchQueue.main.async { positionTray() }
    }
}
let watcher = ScreenWatcher()
NotificationCenter.default.addObserver(
    watcher, selector: #selector(ScreenWatcher.screensChanged(_:)),
    name: NSApplication.didChangeScreenParametersNotification, object: nil)

// 全局鼠标转发：只用来判断鼠标是否停在环带上（30ms 节流；不做任何放大/特写）
var lastMouseSend: TimeInterval = 0
let mouseMonitor = NSEvent.addGlobalMonitorForEvents(
    matching: [.mouseMoved, .leftMouseDragged, .rightMouseDragged]) { event in
    let now = Date().timeIntervalSince1970
    guard now - lastMouseSend > 0.03, let pt = event.cgEvent?.location else { return }
    lastMouseSend = now
    for win in windows {
        let f = win.frame
        let x = pt.x - f.origin.x
        let y = f.height - (pt.y - f.origin.y)
        if x >= 0, x <= f.width, y >= 0, y <= f.height {
            (win.contentView as? WallpaperView)?.forwardMouse(x: x, y: y)
        }
    }
}
_ = mouseMonitor

// 全局点击转发：待机圆环点击冲击波（壁纸窗口 ignoresMouseEvents，只能靠全局监听）
let clickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown]) { event in
    guard let pt = event.cgEvent?.location else { return }
    for win in windows {
        let f = win.frame
        let x = pt.x - f.origin.x
        let y = f.height - (pt.y - f.origin.y) // 同上：翻成页面坐标
        if x >= 0, x <= f.width, y >= 0, y <= f.height {
            (win.contentView as? WallpaperView)?.forwardClick(x: x, y: y)
        }
    }
}
_ = clickMonitor

// 右上角托盘：可展开的 agent 切换图标（独立浮窗，接收点击）
final class TrayNav: NSObject, WKNavigationDelegate {
    static let shared = TrayNav()
    private let trayURL = URL(string: "http://127.0.0.1:7799/tray.html")!
    func webView(_ wv: WKWebView, didFail nav: WKNavigation!, withError e: Error) { retry(wv) }
    func webView(_ wv: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError e: Error) { retry(wv) }
    /// 服务尚未起来（开机竞态）或网络抖动：2s 后重试；已加载成功则不动
    private func retry(_ wv: WKWebView) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            if wv.url?.host != "127.0.0.1" {
                wv.load(URLRequest(url: self.trayURL))
            }
        }
    }
}
// HTML 通过 window.webkit.messageHandlers.tray 上报内容高度，宿主据此调整浮窗大小
final class TrayBridge: NSObject, WKScriptMessageHandler {
    weak var panel: NSPanel?
    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "tray", let body = message.body as? [String: Any],
              let h = body["height"] as? Double else { return }
        DispatchQueue.main.async { resizeTray(to: CGFloat(h)) }
    }
}
var trayBridge: TrayBridge?

/// 托盘默认放在「鼠标所在的那块屏」的右上角，屏幕变化时重新贴边
func trayScreen() -> NSScreen {
    let p = NSEvent.mouseLocation
    return NSScreen.screens.first { NSMouseInRect(p, $0.frame, false) } ?? NSScreen.main ?? NSScreen.screens[0]
}

func positionTray() {
    let panel = trayPanel
    let screen = panel.screen ?? trayScreen()
    let vf = screen.visibleFrame
    let w = panel.frame.width, h = panel.frame.height
    panel.setFrame(NSRect(x: vf.maxX - w - 10, y: vf.maxY - h - 8, width: w, height: h), display: true, animate: false)
}

func resizeTray(to height: CGFloat) {
    let panel = trayPanel
    let screen = panel.screen ?? trayScreen()
    let vf = screen.visibleFrame
    let w = panel.frame.width
    let h = max(52, min(640, height))
    if abs(panel.frame.height - h) < 1 { return }
    let frame = NSRect(x: vf.maxX - w - 10, y: vf.maxY - h - 8, width: w, height: h)
    panel.setFrame(frame, display: true, animate: false)
}

private func makeTray() -> NSPanel {
    let size = NSSize(width: 64, height: 64)
    let screen = trayScreen()
    let vf = screen.visibleFrame
    let frame = NSRect(x: vf.maxX - size.width - 10,
                       y: vf.maxY - size.height - 8,
                       width: size.width, height: size.height)
    let panel = NSPanel(contentRect: frame,
                        styleMask: [.borderless, .nonactivatingPanel],
                        backing: .buffered,
                        defer: false)
    // 与壁纸同一桌面层级（+1 只保证浮在壁纸之上）：只随桌面显示，
    // 应用窗口覆盖右上角时托盘自然被遮住，绝不浮在其他应用之上
    panel.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)) + 1)
    // 注意不再加 .fullScreenAuxiliary：全屏 App 的空间里也不许冒头
    panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
    panel.backgroundColor = .clear
    panel.isOpaque = false
    panel.hasShadow = false
    panel.ignoresMouseEvents = false    // 与壁纸相反：托盘接收点击
    panel.hidesOnDeactivate = false
    let cfg = WKWebViewConfiguration()
    let bridge = TrayBridge()
    cfg.userContentController.add(bridge, name: "tray")
    trayBridge = bridge
    let wv = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: cfg)
    wv.autoresizingMask = [.width, .height]
    wv.navigationDelegate = TrayNav.shared
    wv.isInspectable = true
    wv.setValue(false, forKey: "drawsBackground")  // 透明底：让桌面透出来，白色图标才可见
    let req = URLRequest(
        url: URL(string: "http://127.0.0.1:7799/tray.html")!,
        cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
        timeoutInterval: 30)
    // 等 runloop 起来后再发请求，避免启动竞态导致白屏
    DispatchQueue.main.async {
        wv.load(req)
    }
    panel.contentView = wv
    panel.orderFrontRegardless()
    bridge.panel = panel
    return panel
}
let trayPanel = makeTray()

app.run()
