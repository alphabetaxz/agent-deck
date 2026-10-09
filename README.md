# Agent Deck

把旧 Android 手机变成桌面状态屏。Mac 管理 Todo、Agent 状态和插件，手机显示你需要关注的信息。

**当前为 v0.1 开发预览，不是完成的发布版。** 独立进程插件、Todo、时钟、Agent 事件桥接和浏览器显示链路已实现。真实 Android 兼容、Codex 桌面会话发现、二维码配对和完整原生管理界面仍待完成。

## 运行

要求：macOS 14+、Node.js 24.5+、Swift 6（构建 Mac App）。核心无第三方 npm 依赖，使用 Node 内置 SQLite；当前 Node 版本会提示该模块为实验性 API。

```sh
cd ~/workspace/code/agent-deck
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

本机预览通过管理界面的「打开显示预览」使用。连接真实手机时，需要为局域网地址配置有效 TLS 证书，并让设备正常信任证书；项目不会禁用证书校验或自动配置系统信任。

```sh
node core/main.mjs --data .data --host 0.0.0.0 --cert /path/to/cert.pem --key /path/to/key.pem
```

使用 Mac App 启动 LAN 服务时，可设置 `AGENT_DECK_HOST`、`AGENT_DECK_CERT`、`AGENT_DECK_KEY`。证书需要覆盖实际使用的地址；手机和 Mac 在同一局域网。管理端生成 8 位配对码，2 分钟有效且一次使用。手机打开显示地址输入配对码，配对后只获得显示权限。设备可随时在 Mac 撤销。

本机管理 URL 和 Agent 采集 URL 使用 `127.0.0.1`，TLS 证书也必须覆盖它。若使用私有 CA，Node 采集进程需正常信任该 CA，例如通过 `NODE_EXTRA_CA_CERTS` 指定 CA 文件。证书部署体验尚未产品化，这是手机实机验证前的主要待办。

显示端提供全屏和亮屏按钮；亮屏依赖设备浏览器能力。在不支持的旧浏览器上会提示采用系统休眠设置。尚未在真实旧 Android 上验证。

## Agent 接入

在 Mac App 的「Agent 接入」区域操作，无需编辑配置、设置环境变量或给 pi 添加启动参数：

1. App 自动检测 Claude Code、pi、Codex CLI 是否可运行；安装工具后可点击「重新检测」。
2. 点击「一键接入」。App 自动启用「编程 Agent」插件，合并已有 Hooks 或安装自动发现的 pi 扩展，并保存数据目录。
3. 照常打开一个新会话。App 收到实际事件后才显示「已收到状态」。

安装前自动备份到数据目录的 `backups/`。重复安装不会增加重复 Hooks；移除只清理 Agent Deck 自己安装的条目。已有同名 pi 扩展或被修改的扩展会保留并报告冲突。配置文件使用符号链接时暂不自动修改。

Codex 首次使用仍须在工具自身确认 Hook 信任（官方安全要求，App 不绕过）。App 自动写入 Hooks 并开启支持的 Hooks 功能开关；移除时只恢复仍与安装记录一致的开关。配置写入成功与实际连接分开显示。本机 Codex CLI 缺少可执行文件，界面会显示工具无法启动；真实 Codex CLI 尚未验证。**不宣称支持旁观 Codex 桌面 App 的会话。**

接入脚本只观察事件，不接管审批。服务不可用时短超时退出，让工具继续工作。pi 扩展面向 `@earendil-works/pi-coding-agent` 0.87.1，使用 `agent_settled` 判断本轮停止并每 15 秒发送存活心跳。

开发者仍可用 `scripts/hook-config.mjs` 生成手动配置片段，或用 `pi --extension ./integrations/pi-extension.ts` 临时加载；自定义数据目录时这些手动方式需要 `AGENT_DECK_DATA`。App 安装方式不需要该变量。

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
