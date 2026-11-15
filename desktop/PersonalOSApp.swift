import SwiftUI
import WebKit

private let appURL = URL(string: "http://localhost:3016/assistant")!

@MainActor
final class PersonalOSRuntime: ObservableObject {
    @Published var ready = false
    @Published var status = "Waking Personal OS…"
    private var server: Process?
    private var logHandle: FileHandle?
    private var startedServer = false

    func start() {
        Task {
            if await responds() {
                ready = true
                status = "Ready"
                return
            }
            do {
                try launchServer()
                for _ in 0..<80 {
                    try await Task.sleep(nanoseconds: 375_000_000)
                    if await responds() {
                        ready = true
                        status = "Ready"
                        return
                    }
                }
                status = "Personal OS did not finish starting. Check ~/Library/Logs/Personal OS.log."
            } catch {
                status = "Could not start Personal OS: \(error.localizedDescription)"
            }
        }
    }

    func stop() {
        guard startedServer, let server, server.isRunning else { return }
        server.terminate()
        logHandle?.closeFile()
    }

    private func responds() async -> Bool {
        var request = URLRequest(url: appURL)
        request.timeoutInterval = 1.5
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }

    private func launchServer() throws {
        guard let resource = Bundle.main.url(forResource: "project-root", withExtension: "txt") else {
            throw NSError(domain: "PersonalOS", code: 1, userInfo: [NSLocalizedDescriptionKey: "The app is missing its project location."])
        }
        let root = try String(contentsOf: resource).trimmingCharacters(in: .whitespacesAndNewlines)
        let escapedRoot = root.replacingOccurrences(of: "'", with: "'\\''")
        let logs = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs")
        try FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
        let logURL = logs.appendingPathComponent("Personal OS.log")
        if !FileManager.default.fileExists(atPath: logURL.path) {
            FileManager.default.createFile(atPath: logURL.path, contents: nil)
        }
        guard let handle = FileHandle(forWritingAtPath: logURL.path) else {
            throw NSError(domain: "PersonalOS", code: 2, userInfo: [NSLocalizedDescriptionKey: "The app could not open its log file."])
        }
        handle.seekToEndOfFile()
        logHandle = handle

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-lc", "cd '\(escapedRoot)' && exec npm run assistant"]
        process.standardOutput = handle
        process.standardError = handle
        try process.run()
        server = process
        startedServer = true
        status = "Starting the local workspace…"
    }
}

struct PersonalOSWebView: NSViewRepresentable {
    let url: URL

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
        private var childWindows: [NSWindow] = []

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let target = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }
            if target.host == "127.0.0.1" || target.host == "localhost" {
                let opensRecoveryInBrowser = URLComponents(url: target, resolvingAgainstBaseURL: false)?
                    .queryItems?
                    .contains(where: { $0.name == "external-recovery" && $0.value == "1" }) == true
                if opensRecoveryInBrowser {
                    var components = URLComponents(url: target, resolvingAgainstBaseURL: false)
                    let queryItems = components?.queryItems?.filter { $0.name != "external-recovery" }
                    components?.queryItems = queryItems
                    if let browserURL = components?.url {
                        NSWorkspace.shared.open(browserURL)
                    }
                    decisionHandler(.cancel)
                    return
                }
                decisionHandler(.allow)
            } else {
                NSWorkspace.shared.open(target)
                decisionHandler(.cancel)
            }
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            guard navigationAction.targetFrame == nil, let target = navigationAction.request.url else {
                return nil
            }

            guard target.host == "127.0.0.1" || target.host == "localhost" else {
                NSWorkspace.shared.open(target)
                return nil
            }

            let childWebView = WKWebView(frame: .zero, configuration: configuration)
            childWebView.navigationDelegate = self
            childWebView.uiDelegate = self
            childWebView.allowsMagnification = true

            let window = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 920, height: 780),
                styleMask: [.titled, .closable, .miniaturizable, .resizable],
                backing: .buffered,
                defer: false
            )
            window.title = "Personal OS — History"
            window.contentView = childWebView
            window.delegate = self
            window.isReleasedWhenClosed = false
            window.center()
            childWindows.append(window)
            window.makeKeyAndOrderFront(nil)

            return childWebView
        }

        func windowWillClose(_ notification: Notification) {
            guard let closingWindow = notification.object as? NSWindow else { return }
            childWindows.removeAll { $0 === closingWindow }
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsMagnification = true
        let cacheTypes: Set<String> = [
            WKWebsiteDataTypeDiskCache,
            WKWebsiteDataTypeMemoryCache,
            WKWebsiteDataTypeOfflineWebApplicationCache,
        ]
        configuration.websiteDataStore.removeData(ofTypes: cacheTypes, modifiedSince: .distantPast) {
            webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData))
        }
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {}
}

@MainActor
final class PersonalOSAppDelegate: NSObject, NSApplicationDelegate {
    var onTerminate: (@MainActor () -> Void)?

    func applicationWillTerminate(_ notification: Notification) {
        onTerminate?()
    }
}

@main
struct PersonalOSApp: App {
    @NSApplicationDelegateAdaptor(PersonalOSAppDelegate.self) private var appDelegate
    @StateObject private var runtime = PersonalOSRuntime()

    var body: some Scene {
        WindowGroup("Personal OS") {
            Group {
                if runtime.ready {
                    PersonalOSWebView(url: appURL)
                } else {
                    VStack(spacing: 18) {
                        Image(systemName: "asterisk")
                            .font(.system(size: 38, weight: .medium))
                            .foregroundColor(Color(red: 0.64, green: 0.33, blue: 0.20))
                        Text(runtime.status)
                            .font(.system(size: 14))
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: 420)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(red: 0.965, green: 0.941, blue: 0.906))
                }
            }
            .frame(minWidth: 980, minHeight: 680)
            .onAppear {
                appDelegate.onTerminate = runtime.stop
                runtime.start()
            }
            .onDisappear { runtime.stop() }
        }
        .defaultSize(width: 1280, height: 860)
        .commands {
            CommandGroup(replacing: .newItem) {}
        }
    }
}
