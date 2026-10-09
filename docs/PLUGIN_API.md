# Plugin API v1

## 清单

```json
{
  "id": "clock",
  "name": "时钟",
  "version": "0.1.0",
  "apiVersion": 1,
  "entrypoint": "index.mjs",
  "cardTypes": ["metric"],
  "permissions": [],
  "defaults": {"format": "24h"},
  "configSchema": {"format": {"type": "string", "enum": ["24h", "12h"]}}
}
```

ID 全局唯一；入口不得逃出插件目录。v1 当前支持 Node 插件入口，IPC 格式允许未来引入其他运行时。配置目前校验基本类型与枚举。

## IPC

stdin/stdout 传递 UTF-8 JSON Lines；日志只能写 stderr。单条消息上限 256 KiB。stdout 解析失败、超限、不兼容版本将导致插件进程停止。主机保留最后卡片并标记插件异常，最多重启三次，用户可手动重启。

主机发送：

- `init`：`apiVersion`、`state`、`config`。
- `ping`：存活检查，5 秒一次；15 秒无响应时停止。
- `request`：`id`、`method`（`action` / `event` / `configure`）、`params`。
- `stop`：请求停止；1 秒未退出则强制结束。

插件发送：

- `ready`：`id`（插件 ID）、`apiVersion`，5 秒内完成握手。
- `pong`：回复存活检查。
- `cards`：该插件所有卡片的完整数组，替换先前数据。
- `state`：该插件的 JSON 状态，核心在 SQLite 命名空间持久化。
- `response`：`id`（请求 ID）、`result` 或 `error`；请求超时 4 秒。

插件只获得自己的配置和状态，默认不传递主机全部环境变量。权限声明目前只有知情用途；`agent-events` 控制 Agent 插件的设计职责，尚不构成 OS 沙箱。

## SDK 示例

```js
import { runPlugin } from '../../sdk/plugin.mjs';
runPlugin(manifest, ctx => ({
  start() {
    ctx.publish([{id:'hello',type:'text',title:'提醒',text:'记得休息',updatedAt:Date.now()}]);
  },
  configure(config) {},
  action({action,params}) {},
  stop() {}
}));
```

`ctx.config` / `ctx.state` 提供当前配置和状态；`ctx.save(value)` 持久化插件状态；`ctx.log()` 写诊断日志。事件与动作串行处理。

## 卡片

所有卡片包含稳定 `id`、`type`、`title`、毫秒时间戳 `updatedAt`，可选 `subtitle`。核心添加 `pluginId` 和 `pluginStatus`。

- status：`status`（idle/running/waiting/completed/error/unknown）、`summary`。
- list：`items` 数组，每项含 `id`、`title`、`done`。
- metric：字符串 `value`、可选 `unit`。
- text：`text`。

不能输出任意 HTML/JS。客户端使用 textContent 渲染文本，防止数据成为页面脚本。

## 显示同步

v0.1 使用 HTTP 快照与 SSE，每次更新发送完整显示快照，含 `apiVersion`、`sequence`、`serverTime`、`cards`、`layout`。重连自动获取当前快照，不需要补齐离线时的事件。浏览器不存储卡片磁盘缓存；断线期间保留页面内最后内容并提示离线。

每台设备的布局目前支持按插件选择可见卡片；动态 Agent 会话自动出现，等待处理优先。位置、卡片尺寸、排序编辑后续扩展。
