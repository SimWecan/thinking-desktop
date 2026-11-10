/**
 * Thinking Desktop — macOS 桌面壁纸宿主
 * 把壁纸页 (http://127.0.0.1:7799/wall) 以桌面窗口层级（desktopWindow level）
 * 铺在所有屏幕上：位于桌面图标之后、不抢焦点、不接收鼠标事件。
 * 用法：由 build-wallpaper.sh 编译为 .app 后 open 启动。
 */

import Cocoa
import WebKit

let WALL_URL = "http://127.0.0.1:7799/wall"

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
    let logURL = URL(fileURLWithPath: "/Users/sim/Documents/MCPServer/Thinking Desktop/logs/tray.log")
    func navLog(_ s: String) {
        let line = "\(Date()) \(s)\n"
        if let h = try? FileHandle(forWritingTo: logURL) {
            h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close()
        } else {
            try? line.data(using: .utf8)?.write(to: logURL)
        }
    }
    func webView(_ wv: WKWebView, didFinish nav: WKNavigation!) {
        navLog("didFinish url=\(wv.url?.absoluteString ?? "?")")
    }
    func webView(_ wv: WKWebView, didFail nav: WKNavigation!, withError e: Error) {
        navLog("didFail err=\(e.localizedDescription)")
        // 失败则 2s 后重试一次
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            if wv.url == nil || wv.url?.absoluteString.contains("tray.html") != true {
                wv.load(URLRequest(url: URL(string: "http://127.0.0.1:7799/tray.html")!))
            }
        }
    }
    func webView(_ wv: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError e: Error) {
        navLog("didFailProvisional err=\(e.localizedDescription)")
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            wv.load(URLRequest(url: URL(string: "http://127.0.0.1:7799/tray.html")!))
        }
    }
}
private func makeTray() -> NSPanel {
    let size = NSSize(width: 64, height: 420)
    let screen = NSScreen.main ?? NSScreen.screens[0]
    let vf = screen.visibleFrame
    let frame = NSRect(x: vf.maxX - size.width - 10,
                       y: vf.maxY - size.height - 8,
                       width: size.width, height: size.height)
    let panel = NSPanel(contentRect: frame,
                        styleMask: [.borderless, .nonactivatingPanel],
                        backing: .buffered,
                        defer: false)
    panel.level = .floating             // 浮于普通窗口之上，可随时点
    panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
    panel.backgroundColor = .clear
    panel.isOpaque = false
    panel.hasShadow = false
    panel.ignoresMouseEvents = false    // 与壁纸相反：托盘接收点击
    panel.hidesOnDeactivate = false
    let wv = WKWebView(frame: NSRect(origin: .zero, size: size))
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
    return panel
}
let trayPanel = makeTray()

app.run()
