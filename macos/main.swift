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
        wv.load(URLRequest(url: URL(string: WALL_URL)!))
        addSubview(wv)
        webView = wv
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

app.run()
