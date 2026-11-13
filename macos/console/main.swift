/**
 * Thinking Desktop — macOS 控制台应用
 * 双击启动的常规窗口应用：加载 http://127.0.0.1:7799/console
 * （运行状态 / AI 通道 / 实时日志 / 重启操作），关窗即退出。
 * 由 build-console.sh 编译为 .app。
 */

import Cocoa
import WebKit
import UniformTypeIdentifiers

let CONSOLE_URL = "http://127.0.0.1:7799/console"

let app = NSApplication.shared
app.setActivationPolicy(.regular)

// 单实例：重复双击只把已有窗口提到前台，不再开第二个控制台
if let bid = Bundle.main.bundleIdentifier {
    let others = NSRunningApplication.runningApplications(withBundleIdentifier: bid)
        .filter { $0.processIdentifier != getpid() }
    if let first = others.first {
        first.activate(options: [.activateAllWindows])
        exit(0)
    }
}

final class ConsoleWindowDelegate: NSObject, NSWindowDelegate {
    func windowWillClose(_ notification: Notification) {
        NSApp.terminate(nil)
    }
}
let winDelegate = ConsoleWindowDelegate()

final class ConsoleNav: NSObject, WKNavigationDelegate {
    static let shared = ConsoleNav()
    private var loaded = false
    func webView(_ wv: WKWebView, didFinish nav: WKNavigation!) { loaded = true }
    func webView(_ wv: WKWebView, didFail nav: WKNavigation!, withError e: Error) { retry(wv) }
    func webView(_ wv: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError e: Error) { retry(wv) }
    /// WebContent 进程被系统回收：控制台会停在空白/最后一帧，必须显式重载
    func webViewWebContentProcessDidTerminate(_ wv: WKWebView) {
        loaded = false
        wv.reload()
    }
    /// 服务尚未起来（开机竞态）或网络抖动：2s 后重试，直到加载成功
    private func retry(_ wv: WKWebView) {
        if loaded { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self, weak wv] in
            guard let self = self, let wv = wv, !self.loaded else { return }
            wv.load(URLRequest(url: URL(string: CONSOLE_URL)!))
        }
    }
}

/// 文件选择：WKWebView 默认不会响应 <input type=file>，必须实现 UIDelegate 的
/// runOpenPanelWith 才会弹出系统选择框（「导入动图」按钮依赖这一条）。
final class ConsoleUI: NSObject, WKUIDelegate {
    static let shared = ConsoleUI()

    func webView(_ webView: WKWebView,
                 runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.title = "选择商标动图"
        panel.message = "支持 PNG / GIF / WebP / JPEG，单张不超过 8MB"
        panel.prompt = "导入"
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.allowedContentTypes = [.png, .gif, .webP, .jpeg]
        panel.treatsFilePackagesAsDirectories = false
        // 有窗口时贴成表单，避免面板跑到别的 Space
        let done: (NSApplication.ModalResponse) -> Void = { resp in
            completionHandler(resp == .OK ? panel.urls : nil)
        }
        if let win = webView.window {
            panel.beginSheetModal(for: win, completionHandler: done)
        } else {
            panel.begin(completionHandler: done)
        }
    }
}

/// 窗口标题跟随页面 <title>（中/英切换时一起变），不再写死中文
final class ConsoleTitleObserver: NSObject {
    weak var window: NSWindow?
    override func observeValue(forKeyPath keyPath: String?, of object: Any?,
                               change: [NSKeyValueChangeKey: Any]?, context: UnsafeMutableRawPointer?) {
        guard keyPath == "title", let wv = object as? WKWebView,
              let t = wv.title, !t.isEmpty else { return }
        window?.title = t
    }
}
let titleObserver = ConsoleTitleObserver()

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
wv.uiDelegate = ConsoleUI.shared
titleObserver.window = window
wv.addObserver(titleObserver, forKeyPath: "title", options: [.new], context: nil)
window.contentView = wv
// 常规应用不驻留壁纸层：控制台是普通窗口，允许系统缓存以降低开销
wv.load(URLRequest(url: URL(string: CONSOLE_URL)!))

window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
app.run()
