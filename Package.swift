// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "AgentDeck", platforms: [.macOS(.v14)], products: [.executable(name: "AgentDeck", targets: ["AgentDeck"])], targets: [.executableTarget(name: "AgentDeck")])
