import Cocoa
import UserNotifications

class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        let args = parseArgs()

        if args["help"] != nil {
            printUsage()
            exit(0)
        }

        guard let message = args["message"] else {
            printUsage()
            exit(1)
        }

        let center = UNUserNotificationCenter.current()
        center.delegate = self

        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            guard granted else {
                fputs("Permission denied: \(error?.localizedDescription ?? "unknown")\n", stderr)
                exit(1)
            }

            let content = UNMutableNotificationContent()
            content.title = args["title"] ?? "TaWTUI"
            content.body = message

            if let subtitle = args["subtitle"] {
                content.subtitle = subtitle
            }

            let soundName = args["sound"] ?? "default"
            content.sound = soundName == "default"
                ? .default
                : UNNotificationSound(named: UNNotificationSoundName(soundName))

            if let activate = args["activate"] {
                content.userInfo = ["activateBundleId": activate]
            }

            let request = UNNotificationRequest(
                identifier: UUID().uuidString,
                content: content,
                trigger: nil
            )

            center.add(request) { error in
                if let error = error {
                    fputs("Error: \(error.localizedDescription)\n", stderr)
                    exit(1)
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { exit(0) }
            }
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        if let bundleId = response.notification.request.content.userInfo["activateBundleId"] as? String,
           let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) {
            let config = NSWorkspace.OpenConfiguration()
            config.activates = true
            NSWorkspace.shared.openApplication(at: appURL, configuration: config)
        }
        completionHandler()
        exit(0)
    }

    private func parseArgs() -> [String: String] {
        var result: [String: String] = [:]
        let args = CommandLine.arguments
        var i = 1
        while i < args.count {
            let key = args[i].hasPrefix("-") ? String(args[i].dropFirst()) : args[i]
            if key == "help" {
                result["help"] = "true"
                i += 1
                continue
            }
            if i + 1 < args.count {
                result[key] = args[i + 1]
                i += 2
            } else {
                i += 1
            }
        }
        return result
    }

    private func printUsage() {
        print("""
        tawtui-notify - macOS notification helper for TaWTUI

        Usage: tawtui-notify [options]

        Options:
          -title VALUE      Notification title (default: TaWTUI)
          -message VALUE    Notification message (required)
          -subtitle VALUE   Notification subtitle
          -sound VALUE      Sound name (default: default)
          -activate ID      Bundle ID of app to activate on click
          -help             Show this help
        """)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
