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
///
/// A join link loses its thread message timestamp. With it, Messenger 3.31.0 only opens the thread panel over
/// whatever chat is on screen. Without it, Messenger resolves the invite hash, opens the chat and highlights the
/// message, the same as a /chats/<chat>/<timestamp> link.
func messengerDeeplink(_ url: URL, baseURL: URL) -> URL? {
    guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false),
          components.scheme?.lowercased() == "better-messenger",
          components.user == nil, components.password == nil,
          let host = components.host?.lowercased(), host == baseURL.host?.lowercased() || host == telemostHost
    else { return nil }
    let path = components.percentEncodedPath, fragment = components.percentEncodedFragment ?? ""
    switch path {
    case "", "/":
        if let join = target(of: fragment, after: "/join/") {
            components.percentEncodedFragment = "/join/" + withoutThreadMessage(join)
        } else if target(of: fragment, after: "/chats/") == nil {
            return nil
        }
    case "/join", "/join/":
        guard !fragment.isEmpty, !fragment.hasPrefix("/") else { return nil }
        components.percentEncodedFragment = withoutThreadMessage(Substring(fragment))
    default:
        guard target(of: path, after: "/chats/") != nil else { return nil }
    }
    components.scheme = "ychat"
    return components.url
}

private func target(of value: String, after prefix: String) -> Substring? {
    value.hasPrefix(prefix) && value.count > prefix.count ? value.dropFirst(prefix.count) : nil
}

/// <invite hash>/<timestamp>/<thread message timestamp> -> <invite hash>/<timestamp>
private func withoutThreadMessage(_ join: Substring) -> String {
    join.split(separator: "/", maxSplits: 2, omittingEmptySubsequences: false).prefix(2).joined(separator: "/")
}
