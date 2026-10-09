# Agent Deck

把旧 Android 手机变成桌面状态屏。Mac 管理 Todo、Agent 状态和插件，手机显示你需要关注的信息。

**当前为 v0.1 开发预览，不是完成的发布版。** 独立进程插件、Todo、时钟、Agent 事件桥接和浏览器显示链路已实现。真实 Android 兼容、完整原生管理界面仍待完成。

## 运行

要求：macOS 14+、Node.js 24.5+、Swift 6（构建 Mac App）。核心使用 Node 内置 SQLite，二维码生成使用 qrcode；当前 Node 版本会提示该模块为实验性 API。

```sh
cd ~/workspace/code/agent-deck
npm ci
npm test
AGENT_DECK_NODE="$(command -v node)" swift run AgentDeck
```

Mac App 启动核心并显示管理窗口。第一次打开后，在插件区域启用「今日待办」「编程 Agent」「时钟」。没有虚构的 Agent 会话或天气、股票数据。

Mac 界面当前使用 SwiftUI + WKWebView 管理页面；插件和卡片仍与界面独立。

生成本机开发用 .app：`zsh scripts/package-dev.sh`，输出到 `dist/Agent Deck Dev.app`。这个开发包装使用当前机器的 Node 路径和项目 `.data` 目录，还不是可分发的正式安装包。构建脚本把编译缓存放在项目目录，适合受限开发环境。

只运行核心与浏览器管理界面：

```sh
node core/main.mjs --data .data
# 在另一个终端打开一次性管理链接
node scripts/open-admin.mjs .data
```

默认只监听 `127.0.0.1:43120`。`.data/runtime.json` 包含凭据，权限为 0600，请不要分享或提交。管理链接一次使用后失效，新的链接写回这个本地文件；再次执行 open-admin 脚本即可重新打开管理页面。核心重启后，已配对设备凭据保留。Mac App 可以连接使用相同数据目录的已运行核心。

## 手机连接

本机预览通过「打开显示预览」使用。连接手机无需手动启动局域网服务：

1. 手机和 Mac 连接同一 Wi-Fi 或局域网。
2. Mac App「显示设备」点击「开启手机连接」，自动启动独立显示端口（默认 43121）。管理端口 43120 仍仅在本机开放。
3. 选择 Mac 的局域网 IP，点击「生成配对二维码」。手机扫码后配对码自动填入，确认连接即可。也可手动输入显示地址和 8 位码。

二维码包含局域网地址和两分钟有效、一次使用的配对码。配对码放在 URL fragment，手机读取后立即清除；管理凭据不会进入二维码。配对后的手机只获得显示权限。Mac 可以撤销配对、关闭手机连接；网络设置保留到下次启动。

默认手机连接使用 HTTP，仅适合可信局域网，传输未加密。HTTP 下亮屏 API 可能不可用。可通过核心启动参数 --cert/--key 或 App 的 AGENT_DECK_CERT/AGENT_DECK_KEY 配置 HTTPS；手机需正常信任证书。系统防火墙和 Wi-Fi 客户端隔离也可能影响连接。真实旧 Android 仍待验证。

显示端提供全屏和亮屏按钮；亮屏依赖设备浏览器能力。在不支持的旧浏览器上会提示采用系统休眠设置。尚未在真实旧 Android 上验证。

## Agent 接入

在 Mac App 的「Agent 接入」区域操作，无需编辑配置、设置环境变量或给 pi 添加启动参数：

1. App 自动检测 Claude Code、pi、Codex CLI 是否可运行；安装工具后可点击「重新检测」。
2. 点击「一键接入」。App 自动启用「编程 Agent」插件，合并已有 Hooks 或安装自动发现的 pi 扩展，并保存数据目录。
3. 照常打开一个新会话。App 收到实际事件后才显示「已收到状态」。

安装前自动备份到数据目录的 `backups/`。重复安装不会增加重复 Hooks；移除只清理 Agent Deck 自己安装的条目。已有同名 pi 扩展或被修改的扩展会保留并报告冲突。配置文件使用符号链接时暂不自动修改。

Codex 首次使用仍须在工具自身确认 Hook 信任（官方安全要求，App 不绕过）。App 自动写入 Hooks 并开启支持的 Hooks 功能开关；移除时只恢复仍与安装记录一致的开关。配置写入成功与实际连接分开显示。本机 Codex CLI 缺少可执行文件，界面会显示工具无法启动；真实 Codex CLI 尚未验证。Codex 桌面版使用独立的只读接入，见下文。

接入脚本只观察事件，不接管审批。服务不可用时短超时退出，让工具继续工作。pi 扩展面向 `@earendil-works/pi-coding-agent` 0.87.1，使用 `agent_settled` 判断本轮停止并每 15 秒发送存活心跳。

开发者仍可用 `scripts/hook-config.mjs` 生成手动配置片段，或用 `pi --extension ./integrations/pi-extension.ts` 临时加载；自定义数据目录时这些手动方式需要 `AGENT_DECK_DATA`。App 安装方式不需要该变量。

### Codex 桌面版

在「Agent 接入」选择「Codex 桌面版」并一键接入。它直接读取本机桌面会话的生命周期记录，无需安装 CLI、修改 Codex 配置或信任新 Hook。已有的近期本地会话可以直接显示，接入设置在重启后保留。

只读本地 state 索引和 sessions 记录，按明确的桌面来源标记排除 CLI、IDE 和子 Agent。每 1.5 秒检查追加数据，显示工作中、完成、中断及记录中明确出现的输入请求。只发布项目名和固定状态说明，聊天正文、工具参数、模型回答不进入卡片。与 Codex CLI 的同一会话使用同一 ID，避免重复卡片。

这是针对已验证本地文件格式的兼容适配器，文件格式变化时会报告错误；并非官方桌面状态订阅 API。当前核对桌面内置 Codex 0.162.0-alpha.2。未覆盖云端任务、ChatGPT Work 的云端聊天以及未写入记录的审批请求。安静超过 5 分钟显示未知，不能推断桌面 App 已退出。当前只观察最近 24 小时更新的最多 32 个本地会话；首次扫描超过 32 MiB 的会话暂不导入，需要新会话。

### 当前状态边界

按来源 + 会话 ID 区分多个会话。本轮完成不自动完成 Todo。工具失败不自动结束整轮任务。支持轮次 ID 时可忽略旧轮次完成事件；缺少轮次 ID 的工具仍依赖事件时间和到达顺序。

pi 超过 45 秒无心跳时显示状态未知。Claude/Codex 目前没有进程发现机制，超过 5 分钟没有事件时保守显示状态未知，不能据此判断 Agent 已退出。重启恢复的会话也先显示未知。

## 插件开发

插件位于 `plugins/<name>/`，包含 `plugin.json` 和运行入口。主程序启动子进程，用 stdin/stdout 传递 JSON Lines。默认所有插件都关闭，用户明确启用后运行。

插件发布标准卡片，客户端统一渲染。目前支持 `status`、`list`、`metric`、`text`。`plugins/clock` 是不修改核心即可增加显示内容的示例。

参见 [插件协议](docs/PLUGIN_API.md)、[开发计划](docs/PLAN.md)、[验证记录](docs/VALIDATION.md)。

当前插件目录需要使用仓库提供的 SDK；尚未提供外部插件安装包、市场或权限沙箱。权限声明用于知情和核心能力控制，独立进程不阻止插件直接访问操作系统资源。不要安装不信任的插件。

## 开发与许可

本项目独立实现，采用 MIT 许可。参考了 [Open Island 的公开接入文档](https://github.com/itdragons/open-vibe-island/blob/wg-v1.0.8/docs/hooks.md)，没有复制其源码或资源。参考版本与待验证事项见验证记录。

```sh
npm test
swift build
```

只在测试中使用模拟事件，运行界面不会将其伪装为真实数据。提交前应完成协议、状态转换和设备访问控制测试。持续运行一整天和真实 Android 检查留到有设备参与的验证阶段。

## GitHub 自动构建

每次 push、Pull Request，以及手动触发 `Build macOS App` 都会执行测试，并分别在 Apple Silicon 和 Intel runner 构建 Release App。打开仓库的 **Actions → Build macOS App → 对应运行 → Artifacts**，下载相应架构的压缩包，解压即可获得 `Agent Deck.app`。产物保留 14 天。

CI 包内置 Node.js 24.5.0 和生产依赖，不包含构建机器路径或用户数据；数据保存在 `~/Library/Application Support/AgentDeck`。本地可用 `AGENT_DECK_NODE=/path/to/standalone/node zsh scripts/package-app.sh` 构建同样的包。需要官方独立 Node 安装中的 LICENSE；Homebrew 外部动态库依赖不会被带入安装包。

当前为 ad-hoc 签名的预览构建，尚未配置 Developer ID 签名和 Apple 公证。GitHub Actions 不会自动发布 Release。
