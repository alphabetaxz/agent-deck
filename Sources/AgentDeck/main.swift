import SwiftUI
import AppKit
import WebKit

@MainActor
private enum DeckIcons {
    static let menuBar: NSImage = {
        let image = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { _ in
            func diamond(_ radius: CGFloat) -> NSBezierPath {
                let path = NSBezierPath()
                path.move(to: NSPoint(x: 9, y: 9 + radius))
                path.line(to: NSPoint(x: 9 + radius, y: 9))
                path.line(to: NSPoint(x: 9, y: 9 - radius))
                path.line(to: NSPoint(x: 9 - radius, y: 9))
                path.close()
                return path
            }
            NSColor.black.setFill()
            let ring = diamond(8)
            ring.append(diamond(5.85))
            ring.windingRule = .evenOdd
            ring.fill()
            diamond(3.6).fill()
            return true
        }
        image.isTemplate = true
        return image
    }()
}

@MainActor
final class DeckService: ObservableObject {
    @Published var url: URL?
    @Published var error: String?
    private var process: Process?
    private var timer: Timer?
    private var attempts = 0
    private var starting = false
    private var stopped = false
    private var monitor: Timer?
    private var checking = false
    private var unhealthy = 0
    private var generation = 0

    private func log(_ message: String) {
        try? FileManager.default.createDirectory(at: data, withIntermediateDirectories: true)
        let file = data.appendingPathComponent("app.log")
        if let size = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > 1_048_576 {
            let previous = data.appendingPathComponent("app.previous.log")
            try? FileManager.default.removeItem(at: previous)
            try? FileManager.default.moveItem(at: file, to: previous)
        }
        if !FileManager.default.fileExists(atPath: file.path) { FileManager.default.createFile(atPath: file.path, contents: nil, attributes: [.posixPermissions: 0o600]) }
        if let handle = try? FileHandle(forWritingTo: file) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: Data((ISO8601DateFormatter().string(from: Date()) + " " + message + "\n").utf8))
        }
    }
    func fail(_ message: String) {
        timer?.invalidate(); timer = nil
        monitor?.invalidate(); monitor = nil
        starting = false; url = nil; error = message
        log(message)
    }
    func refreshLogin() {
        guard let content = try? Data(contentsOf: data.appendingPathComponent("runtime.json")),
              let runtime = try? JSONSerialization.jsonObject(with: content) as? [String: Any],
              let address = runtime["adminURL"] as? String, let next = URL(string: address),
              ["127.0.0.1", "localhost", "::1"].contains(next.host ?? "") else { return }
        if next != url { url = next }
    }
    func retry() {
        stop(); url = nil; error = nil; stopped = false
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(2.5))
            guard !stopped else { return }; start()
        }
    }
    private func watchHealth() {
        monitor?.invalidate(); unhealthy = 0
        monitor = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, !self.checking, !self.stopped, self.error == nil,
                      let content = try? Data(contentsOf: self.data.appendingPathComponent("runtime.json")),
                      let runtime = try? JSONSerialization.jsonObject(with: content) as? [String: Any],
                      let base = runtime["baseURL"] as? String, let baseURL = URL(string: base),
                      ["127.0.0.1", "localhost", "::1"].contains(baseURL.host ?? "") else { return }
                self.checking = true
                let generation = self.generation
                var request = URLRequest(url: baseURL.appendingPathComponent("api/health")); request.timeoutInterval = 2
                var healthy = false
                if let (data, response) = try? await URLSession.shared.data(for: request),
                   (response as? HTTPURLResponse)?.statusCode == 200,
                   let health = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    healthy = health["pid"] as? Int == runtime["pid"] as? Int && health["apiVersion"] as? Int == 1
                }
                self.checking = false
                guard generation == self.generation, !self.stopped else { return }
                self.unhealthy = healthy ? 0 : self.unhealthy + 1
                if self.unhealthy >= 3 { self.fail("后台服务无响应。点击重新连接恢复，待办和配对数据会保留。") }
            }
        }
    }
    let root: URL = {
        if let code = Bundle.main.resourceURL?.appendingPathComponent("code"), FileManager.default.fileExists(atPath: code.appendingPathComponent("core/main.mjs").path) { return code }
        return URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    }()
    let data = (ProcessInfo.processInfo.environment["AGENT_DECK_DATA"] ?? Bundle.main.object(forInfoDictionaryKey: "AgentDeckDataDirectory") as? String).map { URL(fileURLWithPath: $0) } ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("AgentDeck")

    func applyIcon() {
        let icon = Bundle.main.url(forResource: "AgentDeck", withExtension: "icns") ?? root.appendingPathComponent("assets/AgentDeck.icns")
        if let image = NSImage(contentsOf: icon) { NSApplication.shared.applicationIconImage = image }
    }

    func start() {
        guard process == nil, url == nil, !starting else { return }
        starting = true; stopped = false; error = nil
        let launchGeneration = generation
        log("Starting service")
        Task { @MainActor in
            if let content = try? Data(contentsOf: data.appendingPathComponent("runtime.json")),
               let runtime = try? JSONSerialization.jsonObject(with: content) as? [String: Any],
               let base = runtime["baseURL"] as? String, let baseURL = URL(string: base),
               ["127.0.0.1", "localhost", "::1"].contains(baseURL.host ?? ""),
               let expectedPID = runtime["pid"] as? Int,
               let address = runtime["adminURL"] as? String, let adminURL = URL(string: address),
               adminURL.host == baseURL.host, adminURL.port == baseURL.port {
                var request = URLRequest(url: baseURL.appendingPathComponent("api/health")); request.timeoutInterval = 1
                if let (response, _) = try? await URLSession.shared.data(for: request),
                   let health = try? JSONSerialization.jsonObject(with: response) as? [String: Any],
                   health["pid"] as? Int == expectedPID, health["apiVersion"] as? Int == 1 {
                    guard launchGeneration == self.generation, !self.stopped else { return }
                    self.url = adminURL; self.starting = false; self.watchHealth(); self.log("Attached to healthy service"); return
                }
            }
            guard launchGeneration == self.generation, !self.stopped else { return }
            self.starting = false; self.launch()
        }
    }
    private func launch() {
        let task = Process()
        let node = ProcessInfo.processInfo.environment["AGENT_DECK_NODE"] ?? Bundle.main.object(forInfoDictionaryKey: "AgentDeckNodeExecutable") as? String ?? ""
        let pathCandidates = (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map { String($0) + "/node" }
        let bundledNode = Bundle.main.resourceURL?.appendingPathComponent("runtime/node").path ?? ""
        let candidates = [node, bundledNode, "/opt/homebrew/bin/node", "/usr/local/bin/node"] + pathCandidates
        guard let executable = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else { error = "未找到 Node.js 24。设置 AGENT_DECK_NODE 为 Node 可执行文件路径后重试。"; return }
        task.executableURL = URL(fileURLWithPath: executable)
        var arguments = [root.appendingPathComponent("core/main.mjs").path, "--data", data.path]
        let env = ProcessInfo.processInfo.environment
        for (name, flag) in [("AGENT_DECK_PORT", "--port"), ("AGENT_DECK_HOST", "--host"), ("AGENT_DECK_CERT", "--cert"), ("AGENT_DECK_KEY", "--key")] {
            if let value = env[name] { arguments += [flag, value] }
        }
        task.arguments = arguments
        let output = Pipe(); task.standardOutput = output
        task.standardError = Pipe()
        // Drain both pipes; runtime credentials are read from a private local file.
        output.fileHandleForReading.readabilityHandler = { handle in if handle.availableData.isEmpty { handle.readabilityHandler = nil } }
        (task.standardError as? Pipe)?.fileHandleForReading.readabilityHandler = { handle in if handle.availableData.isEmpty { handle.readabilityHandler = nil } }
        let launchGeneration = generation
        task.terminationHandler = { [weak self] task in
            let status = task.terminationStatus
            Task { @MainActor in
                guard let self, !self.stopped, self.generation == launchGeneration else { return }
                self.process = nil
                self.fail("后台服务已退出（代码 \(status)）。点击重新连接恢复。")
            }
        }
        do {
            try task.run(); process = task
            log("Launched service PID \(task.processIdentifier)")
            attempts = 0
            timer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    guard let self, self.generation == launchGeneration, !self.stopped else { return }; self.attempts += 1
                    if let content = try? Data(contentsOf: self.data.appendingPathComponent("runtime.json")),
                       let runtime = try? JSONSerialization.jsonObject(with: content) as? [String: Any],
                       runtime["pid"] as? Int == Int(task.processIdentifier),
                       let address = runtime["adminURL"] as? String, let url = URL(string: address) {
                        self.url = url; self.timer?.invalidate(); self.timer = nil; self.watchHealth(); self.log("Service ready")
                    } else if self.attempts > 100 || !task.isRunning {
                        self.fail("核心服务启动失败。端口 43120 可能已被其他 Agent Deck 占用；退出其他版本后点击重新连接。")
                    }
                }
            }
        } catch { self.fail("无法启动服务：" + error.localizedDescription) }
    }
    func stop() {
        stopped = true; generation += 1; starting = false
        timer?.invalidate(); timer = nil; monitor?.invalidate(); monitor = nil
        if let child = process, child.isRunning {
            child.terminationHandler = nil; child.terminate()
            // Never wait on the UI thread. Kill only our own child if graceful exit stalls.
            DispatchQueue.global().asyncAfter(deadline: .now() + 2) {
                if child.isRunning { kill(child.processIdentifier, SIGKILL) }
            }
        }
        process = nil
    }
}

struct ManagementView: NSViewRepresentable {
    let url: URL
    let onFailure: (String) -> Void
    let onLogin: () -> Void
    @MainActor final class Coordinator: NSObject, WKUIDelegate, WKNavigationDelegate, NSWindowDelegate {
        var loadedURL: URL?
        var onFailure: (String) -> Void
        var onLogin: () -> Void
        init(onFailure: @escaping (String) -> Void, onLogin: @escaping () -> Void) { self.onFailure = onFailure; self.onLogin = onLogin }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            if (error as NSError).code != NSURLErrorCancelled { onFailure("页面加载失败，请点击重新连接。") }
        }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            if (error as NSError).code != NSURLErrorCancelled { onFailure("页面连接中断，请点击重新连接。") }
        }
        func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse) async -> WKNavigationResponsePolicy {
            if navigationResponse.isForMainFrame, (navigationResponse.response as? HTTPURLResponse)?.statusCode == 401 {
                onLogin(); return .cancel
            }
            return .allow
        }
        func windowWillClose(_ notification: Notification) { windows.removeAll { $0 === notification.object as? NSWindow } }
        var windows: [NSWindow] = []
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            guard navigationAction.targetFrame == nil else { return nil }
            let child = WKWebView(frame: NSRect(x: 0, y: 0, width: 480, height: 800), configuration: configuration)
            child.uiDelegate = self; child.navigationDelegate = self
            let window = NSWindow(contentRect: child.frame, styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            window.title = "Agent Deck · 显示预览"; window.contentView = child; window.isReleasedWhenClosed = false; window.delegate = self
            windows.append(window); window.makeKeyAndOrderFront(nil); return child
        }
    }
    func makeCoordinator() -> Coordinator { Coordinator(onFailure: onFailure, onLogin: onLogin) }
    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.uiDelegate = context.coordinator; view.navigationDelegate = context.coordinator
        context.coordinator.loadedURL = url; view.load(URLRequest(url: url)); return view
    }
    func updateNSView(_ view: WKWebView, context: Context) {
        guard context.coordinator.loadedURL != url else { return }
        context.coordinator.loadedURL = url; view.load(URLRequest(url: url))
    }
}

// The detector runs outside the UI thread so a frozen UI can still be diagnosed.
private final class UIResponsivenessMonitor: @unchecked Sendable {
    private let lock = NSLock()
    private var heartbeat = ProcessInfo.processInfo.systemUptime
    private var lastSample = -Double.infinity
    private var timer: DispatchSourceTimer?
    func start(data: URL) {
        guard timer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "dev.agentdeck.responsiveness", qos: .utility))
        timer.schedule(deadline: .now() + 10, repeating: 10)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            let now = ProcessInfo.processInfo.systemUptime
            self.lock.lock()
            let stalled = now - self.heartbeat > 30 && now - self.lastSample > 120
            if stalled { self.lastSample = now }
            self.lock.unlock()
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.lock.lock(); self.heartbeat = ProcessInfo.processInfo.systemUptime; self.lock.unlock()
            }
            if stalled {
                let report = data.appendingPathComponent("hang-sample.txt")
                let process = Process()
                process.executableURL = URL(fileURLWithPath: "/usr/bin/sample")
                process.arguments = [String(ProcessInfo.processInfo.processIdentifier), "3", "-file", report.path]
                process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
                process.terminationHandler = { _ in
                    try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: report.path)
                }
                try? process.run()
            }
        }
        self.timer = timer; timer.resume()
    }
    func stop() { timer?.cancel(); timer = nil }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    private let responsiveness = UIResponsivenessMonitor()
    var service: DeckService?
    func applicationDidFinishLaunching(_ notification: Notification) {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = DeckIcons.menuBar
        item.button?.toolTip = "Agent Deck"
        let menu = NSMenu()
        for (title, action) in [("打开管理窗口", #selector(showManagement)), ("重新连接服务", #selector(reconnect)), ("查看诊断日志", #selector(showDiagnostics)), ("退出", #selector(quit))] {
            let entry = NSMenuItem(title: title, action: action, keyEquivalent: "")
            entry.target = self; menu.addItem(entry)
        }
        item.menu = menu; statusItem = item
        if let service { responsiveness.start(data: service.data) }
    }
    func watchUI() { if let service { responsiveness.start(data: service.data) } }
    @objc private func showManagement() {
        let visible = NSApplication.shared.windows.contains { $0.title == "Agent Deck" && $0.isVisible }
        if !visible, service?.url != nil { service?.refreshLogin() }; openManagement?()
    }
    @objc private func reconnect() { service?.retry(); openManagement?() }
    @objc private func showDiagnostics() {
        guard let service else { return }
        NSWorkspace.shared.activateFileViewerSelecting([service.data.appendingPathComponent("app.log")])
    }
    @objc private func quit() { NSApplication.shared.terminate(nil) }
    var openManagement: (() -> Void)?
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag, service?.url != nil { service?.refreshLogin() }; openManagement?(); return true
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationWillTerminate(_ notification: Notification) { responsiveness.stop(); service?.stop() }
}

@main
struct AgentDeckApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var service = DeckService()
    @Environment(\.openWindow) private var openWindow
    var body: some Scene {
        WindowGroup("Agent Deck", id: "management") {
            Group {
                if let url = service.url { ManagementView(url: url, onFailure: { service.fail($0) }, onLogin: { service.refreshLogin() }) }
                else if let error = service.error { VStack(spacing: 16) { Image(systemName: "exclamationmark.triangle").font(.largeTitle); Text(error).multilineTextAlignment(.center).padding(); Button("重新连接") { service.retry() } } }
                else { ProgressView("正在启动 Agent Deck…") }
            }
            .frame(minWidth: 920, minHeight: 680)
            .onAppear { delegate.service = service; delegate.watchUI(); delegate.openManagement = {
                if let window = NSApplication.shared.windows.first(where: { $0.title == "Agent Deck" }) { window.makeKeyAndOrderFront(nil) } else { openWindow(id: "management") }
                NSApplication.shared.activate(ignoringOtherApps: true)
            }; if service.url != nil { service.refreshLogin() }; service.applyIcon(); service.start(); NSApplication.shared.setActivationPolicy(.regular); NSApplication.shared.activate(ignoringOtherApps: true) }
        }
    }
}
