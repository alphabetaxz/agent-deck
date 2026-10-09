import SwiftUI
import AppKit
import WebKit

@MainActor
final class DeckService: ObservableObject {
    @Published var url: URL?
    @Published var error: String?
    private var process: Process?
    private var timer: Timer?
    private var attempts = 0
    private var starting = false
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
        starting = true
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
                    self.url = adminURL; self.starting = false; return
                }
            }
            self.starting = false; self.launch()
        }
    }
    private func launch() {
        let task = Process()
        let node = ProcessInfo.processInfo.environment["AGENT_DECK_NODE"] ?? Bundle.main.object(forInfoDictionaryKey: "AgentDeckNodeExecutable") as? String ?? ""
        let pathCandidates = (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map { String($0) + "/node" }
        let candidates = [node, "/opt/homebrew/bin/node", "/usr/local/bin/node"] + pathCandidates
        guard let executable = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else { error = "未找到 Node.js 24。设置 AGENT_DECK_NODE 为 Node 可执行文件路径后重试。"; return }
        task.executableURL = URL(fileURLWithPath: executable)
        var arguments = [root.appendingPathComponent("core/main.mjs").path, "--data", data.path]
        let env = ProcessInfo.processInfo.environment
        for (name, flag) in [("AGENT_DECK_HOST", "--host"), ("AGENT_DECK_CERT", "--cert"), ("AGENT_DECK_KEY", "--key")] {
            if let value = env[name] { arguments += [flag, value] }
        }
        task.arguments = arguments
        let output = Pipe(); task.standardOutput = output
        task.standardError = Pipe()
        // Drain both pipes; runtime credentials are read from a private local file.
        output.fileHandleForReading.readabilityHandler = { handle in _ = handle.availableData }
        (task.standardError as? Pipe)?.fileHandleForReading.readabilityHandler = { handle in _ = handle.availableData }
        do {
            try task.run(); process = task
            attempts = 0
            timer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    guard let self else { return }; self.attempts += 1
                    if let content = try? Data(contentsOf: self.data.appendingPathComponent("runtime.json")),
                       let runtime = try? JSONSerialization.jsonObject(with: content) as? [String: Any],
                       runtime["pid"] as? Int == Int(task.processIdentifier),
                       let address = runtime["adminURL"] as? String, let url = URL(string: address) {
                        self.url = url; self.timer?.invalidate(); self.timer = nil
                    } else if self.attempts > 30 || !task.isRunning {
                        self.error = "核心服务启动失败。端口 43120 可能已被使用；请查看 README 的手动运行方式。"
                        self.timer?.invalidate(); self.timer = nil
                    }
                }
            }
        } catch { self.error = error.localizedDescription }
    }
    func stop() { timer?.invalidate(); if process?.isRunning == true { process?.terminate() }; process = nil }
}

struct ManagementView: NSViewRepresentable {
    let url: URL
    @MainActor final class Coordinator: NSObject, WKUIDelegate {
        var windows: [NSWindow] = []
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            guard navigationAction.targetFrame == nil else { return nil }
            let child = WKWebView(frame: NSRect(x: 0, y: 0, width: 480, height: 800), configuration: configuration)
            child.uiDelegate = self
            let window = NSWindow(contentRect: child.frame, styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            window.title = "Agent Deck · 显示预览"; window.contentView = child; window.isReleasedWhenClosed = false
            windows.append(window); window.makeKeyAndOrderFront(nil); return child
        }
    }
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.uiDelegate = context.coordinator
        view.load(URLRequest(url: url)); return view
    }
    func updateNSView(_ view: WKWebView, context: Context) {}
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    var service: DeckService?
    func applicationWillTerminate(_ notification: Notification) { service?.stop() }
}

@main
struct AgentDeckApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var service = DeckService()
    var body: some Scene {
        WindowGroup("Agent Deck") {
            Group {
                if let url = service.url { ManagementView(url: url) }
                else if let error = service.error { VStack(spacing: 16) { Image(systemName: "exclamationmark.triangle").font(.largeTitle); Text(error).multilineTextAlignment(.center).padding() } }
                else { ProgressView("正在启动 Agent Deck…") }
            }
            .frame(minWidth: 920, minHeight: 680)
            .onAppear { delegate.service = service; service.applyIcon(); service.start(); NSApplication.shared.setActivationPolicy(.regular); NSApplication.shared.activate(ignoringOtherApps: true) }
        }
        MenuBarExtra("Agent Deck", systemImage: "rectangle.grid.1x2") {
            Button("打开管理窗口") { NSApplication.shared.activate(ignoringOtherApps: true); NSApplication.shared.windows.first?.makeKeyAndOrderFront(nil) }
            Button("退出") { NSApplication.shared.terminate(nil) }
        }
    }
}
