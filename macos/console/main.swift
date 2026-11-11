/**
 * Thinking Desktop — macOS 控制台应用
 * 双击启动的常规窗口应用：加载 http://127.0.0.1:7799/console
 * （运行状态 / AI 通道 / 实时日志 / 重启操作），关窗即退出。
 * 由 build-console.sh 编译为 .app。
 */

import Cocoa
import WebKit

let CONSOLE_URL = "http://127.0.0.1:7799/console"

let app = NSApplication.shared
app.setActivationPolicy(.regular)

final class ConsoleWindowDelegate: NSObject, NSWindowDelegate {
    func windowWillClose(_ notification: Notification) {
        NSApp.terminate(nil)
    }
}
let winDelegate = ConsoleWindowDelegate()

final class ConsoleNav: NSObject, WKNavigationDelegate {
    static let shared = ConsoleNav()
    func webView(_ wv: WKWebView, didFail nav: WKNavigation!, withError e: Error) { retry(wv) }
    func webView(_ wv: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError e: Error) { retry(wv) }
    /// 服务尚未起来（开机竞态）或网络抖动：2s 后重试；已加载成功则不动
    private func retry(_ wv: WKWebView) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            if wv.url?.host != "127.0.0.1" {
                wv.load(URLRequest(url: URL(string: CONSOLE_URL)!))
            }
        }
    }
}

let rect = NSRect(x: 0, y: 0, width: 1000, height: 660)
let window = NSWindow(
    contentRect: rect,
    styleMask: [.titled, .closable, .miniaturizable, .resizable],
    backing: .buffered,
    defer: false)
window.title = "Thinking Desktop 控制台"
window.minSize = NSSize(width: 720, height: 460)
window.center()
window.delegate = winDelegate

let cfg = WKWebViewConfiguration()
let wv = WKWebView(frame: rect, configuration: cfg)
wv.autoresizingMask = [.width, .height]
wv.navigationDelegate = ConsoleNav.shared
window.contentView = wv
// 常规应用不驻留壁纸层：控制台是普通窗口，允许系统缓存以降低开销
wv.load(URLRequest(url: URL(string: CONSOLE_URL)!))

window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
app.run()
