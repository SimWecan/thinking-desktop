/**
 * AX 读屏小工具：读取指定 App 前台窗口里的可见文本，供 Thinking Desktop 给
 * 「不落盘文本日志」的闭源桌面端（Gemini / ChatGPT）补上真实文本。
 *
 * 用法：
 *   axread com.google.GeminiMacOS com.openai.codex
 * 输出：
 *   {"trusted":true,"apps":{"com.google.GeminiMacOS":"…","com.openai.codex":"…"}}
 *   未授权时：{"trusted":false,"apps":{}}
 *
 * 需要「系统设置 → 隐私与安全性 → 辅助功能」里勾选本二进制（或运行它的宿主）。
 */

import Cocoa
import ApplicationServices

let MAX_CHARS = 6000
let MAX_DEPTH = 16
let MAX_NODES = 4000

func attr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
    var v: CFTypeRef?
    return AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success ? v : nil
}

/// 递归收集窗口内的文本（静态文本 / 文本域 / 输入框），带预算防止卡死
func collect(_ el: AXUIElement, depth: Int, nodes: inout Int, budget: inout Int, out: inout [String]) {
    if depth > MAX_DEPTH || nodes > MAX_NODES || budget <= 0 { return }
    nodes += 1

    if let role = attr(el, kAXRoleAttribute) as? String {
        let textual = [kAXStaticTextRole as String, kAXTextAreaRole as String, "AXTextField", "AXHeading"]
        if textual.contains(role) {
            for key in [kAXValueAttribute as String, kAXTitleAttribute as String, "AXDescription"] {
                if let s = attr(el, key) as? String {
                    let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
                    if t.count >= 2 {
                        out.append(t)
                        budget -= t.count
                        break
                    }
                }
            }
        }
    }
    if let kids = attr(el, kAXChildrenAttribute) as? [AXUIElement] {
        for k in kids {
            collect(k, depth: depth + 1, nodes: &nodes, budget: &budget, out: &out)
            if budget <= 0 { return }
        }
    }
}

func windowText(pid: pid_t) -> String {
    let app = AXUIElementCreateApplication(pid)
    var root: AXUIElement?
    if let w = attr(app, kAXFocusedWindowAttribute) {
        root = (w as! AXUIElement)
    } else if let w = attr(app, kAXMainWindowAttribute) {
        root = (w as! AXUIElement)
    }
    guard let win = root else { return "" }
    var out: [String] = []
    var nodes = 0
    var budget = MAX_CHARS
    collect(win, depth: 0, nodes: &nodes, budget: &budget, out: &out)
    let joined = out.joined(separator: "\n")
    return String(joined.suffix(MAX_CHARS))
}

let trusted = AXIsProcessTrusted()
var apps: [String: String] = [:]

if trusted {
    for bid in CommandLine.arguments.dropFirst() {
        let running = NSRunningApplication.runningApplications(withBundleIdentifier: bid)
        guard let app = running.first else { continue }
        let text = windowText(pid: app.processIdentifier)
        if !text.isEmpty { apps[bid] = text }
    }
}

let payload: [String: Any] = ["trusted": trusted, "apps": apps]
if let data = try? JSONSerialization.data(withJSONObject: payload),
   let json = String(data: data, encoding: .utf8) {
    print(json)
} else {
    print("{\"trusted\":false,\"apps\":{}}")
}
