import Foundation

/// messenger.360.yandex.ru redirects to Telemost, so chat links arrive from both hosts.
let telemostHost = "telemost.360.yandex.ru"

/// better-messenger://<host>/<chat route> -> ychat://<host>/<chat route>
///
/// The browser extension swaps https: for better-messenger: the way the Messenger web app swaps it for ychat:,
/// the scheme Yandex Messenger.app registers. The host is the base host or Telemost. Chat routes are the ones
/// Messenger opens from ychat: links:
/// - /#/chats/<chat>[/<timestamp>] and /#/join/<invite hash>[/<timestamp>[/<thread message timestamp>]] (Messenger);
/// - /chats/<chat>[/<timestamp>] and /join#<invite hash>[/<timestamp>[/<thread message timestamp>]] (Telemost).
/// Anything else, such as a Telemost meeting link, is rejected.
func messengerDeeplink(_ url: URL, baseURL: URL) -> URL? {
    guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false),
          components.scheme?.lowercased() == "better-messenger",
          components.user == nil, components.password == nil,
          let host = components.host?.lowercased(), host == baseURL.host?.lowercased() || host == telemostHost,
          isChatRoute(path: components.percentEncodedPath, fragment: components.percentEncodedFragment ?? "")
    else { return nil }
    components.scheme = "ychat"
    return components.url
}

private func isChatRoute(path: String, fragment: String) -> Bool {
    func hasTarget(_ value: String, after prefix: String) -> Bool { value.hasPrefix(prefix) && value.count > prefix.count }
    switch path {
    case "", "/": return hasTarget(fragment, after: "/chats/") || hasTarget(fragment, after: "/join/")
    case "/join", "/join/": return !fragment.isEmpty && !fragment.hasPrefix("/")
    default: return hasTarget(path, after: "/chats/")
    }
}
