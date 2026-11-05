import Foundation

// Prints messengerDeeplink() for each argument after the base URL, "-" when the link is rejected.
@main
struct LinksHarness {
    static func main() {
        let arguments = CommandLine.arguments.dropFirst()
        guard let base = arguments.first.flatMap(URL.init(string:)) else { exit(2) }
        for argument in arguments.dropFirst() {
            print(URL(string: argument).flatMap { messengerDeeplink($0, baseURL: base) }?.absoluteString ?? "-")
        }
    }
}
