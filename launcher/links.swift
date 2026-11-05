import Foundation

/// better-messenger://<base host>/#/chats/<chat>[/<timestamp>] -> ychat://<base host>/#/chats/...
///
/// The browser extension swaps https: for better-messenger: the way the Messenger web app used to swap it
/// for ychat:, the scheme Yandex Messenger.app registers. Anything but a chat link on the base host is rejected.
func messengerDeeplink(_ url: URL, baseURL: URL) -> URL? {
    guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false),
          components.scheme?.lowercased() == "better-messenger",
          components.user == nil, components.password == nil,
          let host = components.host?.lowercased(), host == baseURL.host?.lowercased(),
          let fragment = components.percentEncodedFragment,
          fragment.hasPrefix("/chats/"), fragment.count > "/chats/".count
    else { return nil }
    components.scheme = "ychat"
    return components.url
}
