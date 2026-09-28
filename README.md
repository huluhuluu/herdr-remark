# herdr-remark

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Herdr 0.8.2+](https://img.shields.io/badge/Herdr-0.8.2%2B-89b4fa)](https://github.com/herdrdev/herdr)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-43853d)](https://nodejs.org/)

用两个快捷键，为 Herdr Agent 标记已读／未读、添加简短备注。

[安装](#安装) · [使用](#使用) · [配置](#配置) · [开发](#开发) · [更新记录](CHANGELOG.md)

## 功能

- **一个状态灯**：空闲未读显示蓝色实心圆，工作和阻塞状态优先显示。
- **两行侧边栏**：第一行显示灯、目录名和 Tab 名；第二行显示 Git 分支和备注。
- **浮层备注**：编辑时不切换 pane，默认填入已有备注、Agent 摘要或会话标题。
- **直接运行**：无 npm 依赖、无构建步骤、无后台轮询。

布局示意：

```text
● herdr-remark · 修复登录
main · 等待确认接口参数
```

灯和目录名同色，中间只有一个空格。Tab、分支和备注独立着色；没有分支或备注时隐藏对应内容。

## 安装

需要 **Herdr 0.8.2+、Node.js 18+ 和 Git**，支持 Windows、macOS 和 Linux。推荐使用包含聚焦事件修复的 Herdr 0.9.1 或更新版本。

### 1. 安装插件

```sh
herdr plugin install huluhuluu/herdr-remark
```

### 2. 配置侧边栏和快捷键

将 [config.example.toml](config.example.toml) 合并到 Herdr 的 `config.toml`，然后执行：

```sh
herdr config check
herdr server reload-config
```

用示例中的 `rows` 替换现有 Agent 侧边栏布局，避免重复显示原生灯或状态文字。如果配置了 `rows_by_agent`，也需同步调整对应布局。快捷键若已被占用，可修改示例中的 `key`。

插件会在会话启动时初始化。安装到正在运行的会话后，聚焦 Agent 或使用快捷键即可更新；也可在插件目录运行 `npm run init`，立即刷新所有 Agent。

## 使用

先聚焦需要操作的 Agent，再使用快捷键：

| 快捷键 | 操作 |
| --- | --- |
| `prefix+u` | 切换已读／未读 |
| `prefix+Shift+u` | 打开备注浮层 |

Herdr 默认 `prefix` 是 `Ctrl+B`。例如，切换未读时先按 `Ctrl+B`，松开后按 `U`；编辑备注时先按 `Ctrl+B`，再按 `Shift+U`。

### 状态灯

| Agent 状态 | 灯 | 颜色 |
| --- | --- | --- |
| 工作中 | `●` | 黄色 |
| 阻塞／等待输入 | `●` | 红色 |
| 空闲、已读 | `○` | 绿色 |
| 空闲、未读 | `●` | 蓝色 |
| 未知 | `·` | 灰色 |

手动标为未读后，停留在当前 Agent 不会立即清除；离开后再次进入，会自动标为已读。也可以再次使用快捷键手动清除。

工作或阻塞期间，未读标记会保留，灯仍显示黄／红色；进入空闲后才显示蓝灯。Herdr 的后台完成未查看状态（`done`）同样显示蓝灯。

### 备注

浮层依次使用已有 pane 名称、Agent 提供的 `$summary`、会话标题作为初始内容；没有可用内容时留空。

| 操作 | 效果 |
| --- | --- |
| `Enter` | 保存备注并关闭浮层 |
| 清空内容后按 `Enter` | 删除备注 |
| `Ctrl+C` | 取消编辑 |

备注最多 80 个 Unicode 字符，保存为 Herdr 的原生 pane 名称，随 pane 移动和会话恢复保留。编辑会覆盖已有自定义 pane 名称；保存或取消不会主动改变已读状态。

## 配置

侧边栏布局、颜色和快捷键均在 [config.example.toml](config.example.toml) 中配置。修改后运行 `herdr config check` 和 `herdr server reload-config` 生效。

- 灯采用默认 Catppuccin 的静态配色，可通过 `fg` 修改；不会自动跟随 Herdr 主题切换，也不模拟动画。
- 目录和 Git 分支在聚焦、运行状态变化等事件发生时刷新，不持续轮询。
- 未读标记仅保留在当前 Herdr 运行期间，服务器冷重启后重置；备注由 Herdr 持久保存。
- 当前通过快捷键操作，不提供原生侧边栏右键菜单。

插件 ID 保持为 `huluhlu.agent-inform`，用于兼容已有安装和快捷键。升级时请同步更新侧边栏配置；版本变化见 [CHANGELOG](CHANGELOG.md)。

## 开发

```sh
git clone https://github.com/huluhuluu/herdr-remark.git
cd herdr-remark
herdr plugin link .
npm test
```

无需运行 `npm install`。修改代码后可在 Herdr 会话中执行 `npm run init` 刷新显示；修改插件 manifest 后重新运行 `herdr plugin link .`。

问题反馈和功能建议请提交 [Issue](https://github.com/huluhuluu/herdr-remark/issues)，并附上 Herdr 版本、操作系统及复现步骤。欢迎通过 Pull Request 贡献改进。

## 许可证

[MIT](LICENSE)
