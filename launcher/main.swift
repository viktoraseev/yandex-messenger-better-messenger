import AppKit
import Darwin
import Foundation

struct Configuration: Decodable {
    let nodePath: String
    let appPath: String
    let runtimeKey: String
    let arguments: [String]

    var baseURL: URL? {
        guard let index = arguments.firstIndex(of: "--base-url"), arguments.indices.contains(index + 1) else { return nil }
        return URL(string: arguments[index + 1])
    }
}

struct WorkerEvent: Decodable {
    let event: String
}

final class Launcher: NSObject, NSApplicationDelegate {
    var child: Process?
    var lock: Int32 = -1
    var config: Configuration?
    var resources: URL?
    var logPath: String?
    var reopenAfterExit = false
    var injected = false
    var workerOutput = Data()
    var earlyURLs: [URL] = []
    var pendingLinks: [URL] = []
    var linkFallback: Timer?

    func focusMessenger() {
        guard let config = config else { return }
        for app in NSWorkspace.shared.runningApplications {
            if app.bundleURL?.standardizedFileURL.path == config.appPath {
                app.activate(options: [.activateIgnoringOtherApps])
            }
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            guard let resources = Bundle.main.resourceURL else { throw CocoaError(.fileNoSuchFile) }
            let data = try Data(contentsOf: resources.appendingPathComponent("launcher.json"))
            let loaded = try JSONDecoder().decode(Configuration.self, from: data)
            config = loaded
            self.resources = resources
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("better-messenger-\(getuid())", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            var info = stat()
            guard lstat(directory.path, &info) == 0, info.st_uid == getuid(), (info.st_mode & S_IFMT) == S_IFDIR, (info.st_mode & 0o077) == 0 else { throw CocoaError(.fileWriteNoPermission) }
            let lockPath = directory.appendingPathComponent("\(loaded.runtimeKey).lock").path
            lock = Darwin.open(lockPath, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
            guard lock >= 0 else { throw CocoaError(.fileWriteNoPermission) }
            guard flock(lock, LOCK_EX | LOCK_NB) == 0 else {
                if errno == EWOULDBLOCK {
                    focusMessenger()
                    NSApp.terminate(nil)
                    return
                }
                throw CocoaError(.fileWriteUnknown)
            }
            logPath = directory.appendingPathComponent("\(loaded.runtimeKey).log").path
            try startWorker()
            focusMessenger()
            queueLinks(earlyURLs)
            earlyURLs.removeAll()
        } catch {
            showError(error.localizedDescription)
        }
    }

    func showError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Better Messenger не запустился"
        alert.informativeText = message
        alert.runModal()
        NSApp.terminate(nil)
    }

    func startWorker() throws {
            guard let loaded = config, let resources = resources, let logPath = logPath else { throw CocoaError(.fileNoSuchFile) }
            let logFD = Darwin.open(logPath, O_CREAT | O_WRONLY | O_TRUNC | O_NOFOLLOW, 0o600)
            guard logFD >= 0 else { throw CocoaError(.fileWriteNoPermission) }
            let log = FileHandle(fileDescriptor: logFD, closeOnDealloc: true)
            injected = false
            workerOutput.removeAll()
            let output = Pipe()
            output.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                if data.isEmpty {
                    handle.readabilityHandler = nil
                    return
                }
                log.write(data)
                DispatchQueue.main.async { self.readWorkerEvents(data) }
            }
            let process = Process()
            process.executableURL = URL(fileURLWithPath: loaded.nodePath)
            process.arguments = [resources.appendingPathComponent("src/cli.mjs").path] + loaded.arguments + ["--parent-pid", String(getpid())]
            process.standardInput = FileHandle.nullDevice
            process.standardOutput = output
            process.standardError = log
            process.terminationHandler = { process in
                DispatchQueue.main.async {
                    if self.reopenAfterExit {
                        self.reopenAfterExit = false
                        do { try self.startWorker() } catch { self.showError(error.localizedDescription) }
                        return
                    }
                    if process.terminationStatus != 0 {
                        let alert = NSAlert()
                        alert.messageText = "Better Messenger не запустился"
                        alert.informativeText = "Messenger не закрывался. Диагностика: \(logPath)"
                        alert.runModal()
                    }
                    NSApp.terminate(nil)
                }
            }
            child = process
            try process.run()
    }

    /// The worker launches Messenger only on start, so a restart brings back a Messenger that was quit.
    func restartWorker() {
        guard let child = child, child.isRunning, !reopenAfterExit else { return }
        injected = false
        reopenAfterExit = true
        child.interrupt()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        focusMessenger()
        if let config = config, !NSWorkspace.shared.runningApplications.contains(where: { $0.bundleURL?.standardizedFileURL.path == config.appPath }) {
            restartWorker()
        }
        return false
    }

    // MARK: Links from the browser

    func application(_ application: NSApplication, open urls: [URL]) {
        // On a cold start the URLs arrive before applicationDidFinishLaunching has read launcher.json.
        if config == nil {
            earlyURLs += urls
        } else {
            queueLinks(urls)
        }
    }

    func queueLinks(_ urls: [URL]) {
        guard let baseURL = config?.baseURL else { return }
        for url in urls {
            if let link = messengerDeeplink(url, baseURL: baseURL) {
                pendingLinks.append(link)
            } else {
                NSLog("Better Messenger: ignored link %@", url.absoluteString)
            }
        }
        deliverLinks()
    }

    /// Links wait for the patch so they open in a ready Messenger. A Messenger that quit after the patch was
    /// installed is relaunched through the worker; on a cold start the worker is launching it already.
    func deliverLinks() {
        guard !pendingLinks.isEmpty else { return }
        if messengerIsRunning() {
            if injected {
                openPendingLinks()
                return
            }
        } else if injected {
            restartWorker()
        }
        scheduleLinkFallback()
    }

    /// Without the patch (for example, Messenger was started without inspector) links still open after a timeout.
    func scheduleLinkFallback() {
        guard linkFallback == nil else { return }
        linkFallback = Timer.scheduledTimer(withTimeInterval: 30, repeats: false) { [weak self] _ in
            guard let self = self else { return }
            self.linkFallback = nil
            if self.messengerIsRunning() {
                self.openPendingLinks()
            } else {
                NSLog("Better Messenger: Messenger did not start, dropped %d link(s)", self.pendingLinks.count)
                self.pendingLinks.removeAll()
            }
        }
    }

    func openPendingLinks() {
        linkFallback?.invalidate()
        linkFallback = nil
        guard let config = config, !pendingLinks.isEmpty else { return }
        let links = pendingLinks
        pendingLinks.removeAll()
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        NSWorkspace.shared.open(links, withApplicationAt: URL(fileURLWithPath: config.appPath), configuration: configuration) { _, error in
            if let error = error { NSLog("Better Messenger: could not open links: %@", error.localizedDescription) }
        }
    }

    func messengerIsRunning() -> Bool {
        guard let config = config else { return false }
        return NSWorkspace.shared.runningApplications.contains { $0.bundleURL?.standardizedFileURL.path == config.appPath && $0.isFinishedLaunching }
    }

    /// The worker prints one JSON event per line; "installed" means the patch is in Messenger.
    func readWorkerEvents(_ data: Data) {
        workerOutput.append(data)
        while let newline = workerOutput.firstIndex(of: 0x0A) {
            let line = workerOutput.subdata(in: workerOutput.startIndex..<newline)
            workerOutput.removeSubrange(workerOutput.startIndex...newline)
            if (try? JSONDecoder().decode(WorkerEvent.self, from: line))?.event == "installed" {
                injected = true
                deliverLinks()
            }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let child = child, child.isRunning { child.interrupt() }
        if lock >= 0 { Darwin.close(lock) }
    }
}

let application = NSApplication.shared
let delegate = Launcher()
application.delegate = delegate
application.setActivationPolicy(.accessory)
application.run()
