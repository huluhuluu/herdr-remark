# Remark for Herdr

[![Tests](https://github.com/huluhuluu/herdr-remark/actions/workflows/test.yml/badge.svg)](https://github.com/huluhuluu/herdr-remark/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) · **简体中文**

在 Herdr 中跟踪 Agent 完成回合、标记已读并添加简短备注。无需 npm 依赖、构建步骤、Agent 包装器或 Herdr 补丁。

![侧栏布局与备注浮层示意图](docs/images/preview.svg)

*布局示意图，并非实机截图。* 第一行：状态灯＋目录 · Tab；第二行：Git 分支 · 备注。空字段自动隐藏。

[安装](#安装) · [使用](#使用) · [兼容性](#兼容性) · [配置](#配置) · [更新](#更新) · [排查问题](#排查问题)

## 兼容性

Remark 使用 Herdr 的统一 pane 身份与状态 API，**没有 Agent 名称白名单**。Codex、Claude Code、DST（当前实测环境中报告为 `dsh-tui`），以及其他 [Herdr 识别或自行报告状态的 Agent](https://herdr.dev/docs/agents/) 均走相同逻辑，与 Agent 背后的模型／服务商无关。前提是 Herdr 能识别该 pane 并正确报告状态；Remark 不为原本未被识别的 Agent 添加检测规则。

| 运行环境 | 状态、备注、快捷键 | Herdr pane 回滚→已读 | 应用内部接管滚轮→已读 |
| --- | --- | --- | --- |
| Windows＋Windows Terminal | 支持 | 支持 | 支持，使用只读原生监听 |
| Windows＋WezTerm | 支持 | 支持 | 已实现只读 CLI 匹配，待人工滚轮确认 |
| Windows＋Console Host／OpenConsole | 支持 | 支持 | 已实现，要求提供 UIA TextPattern；待人工确认 |
| Windows＋其他终端 | 支持 | 支持 | 尚未实现 |
| macOS | 支持 | 支持 | 尚未实现 |
| Linux | 支持 | 支持 | 尚未实现 |
| SSH／远端服务器 | 通过目标服务器 API | 两种连接方式均支持，见下文 | 未实现跨机器原生监听转发 |

要求 **Herdr 0.9.5+、Node.js 18+ 和 Git**，且 Herdr 插件进程能够找到这些可执行文件。Remark 使用原生 `completion_seq` 确认真正完成的回合；启动、恢复及切换对话不会创建完成回合，参见 [Herdr 的完成语义](https://herdr.dev/docs/agent-automation/)。

Windows Terminal 滚动已读已在 Herdr 0.9.1 会话中确认可用。CI 覆盖 Windows、macOS、Linux 和 Node.js 18/20/22/24；Agent 接口回归测试包含 Codex、Claude Code、DST／`dsh-tui`、OpenCode、Copilot 及任意自定义名称。测试验证的是统一 API 行为，**不代表逐一安装、实测了所有 Agent 和终端**。原生 macOS／Linux 桌面交互尚未手工验证。

已通过 SSH 在隔离的 Ubuntu 22.04 会话中，使用 Herdr 0.9.5、Node.js 22.22.0 和自行上报状态的测试 Agent，验证安装／检查／重复安装、TUI 快捷键与备注编辑、工作灯闪烁、完成与已读跟踪、聚焦／Tab 改名、终端回滚已读及监控退出。滚动输入通过终端 PTY 注入，不代表验证了桌面实体滚轮或全屏应用内滚动。

另以共享插件存储的两个并发服务端，验证独立闪烁、已读标记、监控重载和退出。也在 Windows 客户端与远端 Linux 服务端之间，验证下述两条 SSH 滚动链路。

### 终端与 Shell

在支持的终端中运行 Windows 版 Herdr／Node 时，PowerShell、PowerShell 7、CMD、Git Bash 使用相同实现。提供窗口与文本接口的是终端宿主，与 Shell 和 Agent 无关。Herdr／Node 若运行在 **WSL、SSH 或容器内部**，即使窗口是 Windows Terminal 或 WezTerm，也无法使用本地 Windows 监听器；公开 Herdr 终端回滚识别仍然可用。

- **Windows Terminal／Preview：** 共用监听器核对前台窗口，通过 [UI Automation TextPattern](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-textpattern-overview) 匹配 pane 可见内容及坐标。
- **Windows 版 WezTerm：** 使用运行中 GUI 同目录的 `wezterm.exe`，兼容便携版；无需修改 Lua 配置、绑定鼠标或包装 Agent。只读 [`list-clients`](https://wezterm.org/cli/cli/list-clients.html)、[`list`](https://wezterm.org/cli/cli/list.html)、[`get-text`](https://wezterm.org/cli/cli/get-text.html) 共同核对 GUI PID、聚焦的终端 pane 和 Herdr 内容。命令带 `--no-auto-start`，不会启动终端或 mux 服务。继承的 `WEZTERM_UNIX_SOCKET` 或公开窗口 class 发现机制需要能连接目标 GUI；同一 class 下有多个独立 GUI 实例时，可能需要从目标实例启动 Herdr，以继承它的 socket。
- **Console Host（`conhost.exe`）／OpenConsole：** 复用文本适配器，不再限定 `TermControl` 类名；要求宿主通过 TextPattern 提供可见文本和字符矩形。属于能力检测支持，不代表所有控制台版本均提供这些接口。
- **其他终端**，包括 Alacritty、mintty、ConEmu、Tabby、Hyper：基础功能通过 Herdr 工作，全屏应用内滚轮识别尚未实现。仅添加进程名不能补齐文本与几何接口。

已使用本机 **WezTerm 20240203-110809-5046fc22** 的 CLI 和临时 GUI 验证进程身份、pane 文本、像素尺寸、内容范围，以及非聚焦窗口拒绝判定。自动测试覆盖分屏／缩放 pane、Unicode 侧栏、边距、内容歧义和焦点切换。WezTerm、Console Host／OpenConsole 的真实滚轮→已读仍待人工确认。本次未安装额外终端或 Agent。

WezTerm CLI 不提供边距及标签栏的实际位置，因此使用客户区内所有可能网格位置的共同内容范围。**靠近 pane 边缘滚动可能保留未读**，大边距或 Unicode 前缀下尤为明显，建议在内容区中部滚动。CLI 能力缺失、GUI socket 无法访问或内容匹配不唯一时保留未读；不支持自定义覆盖层。仍可使用其他查看操作，不会为绕过限制修改终端配置。

### SSH 滚动场景

Herdr 的终端界面铺满窗口、窗口最大化，都不代表下面的“应用内部接管滚轮”。判断依据是滚动是否改变了 Herdr pane 的回滚位置。

| 连接方式 | 插件运行位置 | Herdr pane 回滚→已读 |
| --- | --- | --- |
| 先 `ssh workbox`，再在远端运行 `herdr` | 远端服务器 | 已验证 |
| 本机运行 `herdr --remote workbox` | 远端服务器，本机绘制界面 | 已验证 |
| Herdr 的已保存远程机器功能 | 选中的远端服务器 | 使用同一服务端回滚 API；本轮未单独验证机器切换界面 |

两条实测链路均将标准终端滚轮输入传到 Herdr，使服务端回滚位置变化并将未读灯变为已读。测试使用 PTY 输入和自行上报状态的进程，不代表实体滚轮或所有 Agent 的人工验证。远端需要安装 Remark；本机界面使用本机侧栏配置，安装本机插件不会自动安装远端插件。

`herdr --remote` 默认使用本机内置快捷键，不转发本机自定义命令绑定。要使用远端安装器配置的 Remark 快捷键，请运行 `herdr --remote workbox --remote-keybindings server`。这不影响默认连接方式下的滚动已读。

若 Agent／TUI 自己请求鼠标输入，并在自己的界面内滚动，输入可能已经到达远端应用，但 Herdr 的回滚位置不变。两条链路都复现了这一边界，当前不会因此自动标为已读。远端插件不能直接调用本机 Windows 监听器，也没有跨机器的原生滚轮转发；可使用未读快捷键或重新聚焦确认。按住 Shift 让外层终端自行滚动、或终端未转发鼠标事件时，Herdr 也可能收不到滚动。

## 安装

在已有 Herdr 会话中执行：

```sh
git clone https://github.com/huluhuluu/herdr-remark.git
cd herdr-remark
```

**Windows · PowerShell**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

**macOS／Linux · POSIX shell**

```sh
sh scripts/install.sh
```

各平台也可直接执行 `node scripts/install.js`。无需 `npm install`。在任一安装命令后加 `--check`，只校验、不链接插件，也不替换当前配置。

安装器校验配置，在有变化时备份，链接插件并添加侧栏与快捷键。无关配置和已有 POSIX 文件权限会保留；遇到管理区块外已有的侧栏／快捷键冲突时停止。此时手工合并 [config.example.toml](config.example.toml)，再执行 `herdr plugin link .` 和 `npm run init`。已有 `rows_by_agent` 专用布局可能也需要手工加入相同 token。

应用配置失败或仅部分成功时，安装器恢复原配置文件并重新加载；若服务器仍无法重载，会明确说明文件已恢复、运行中的设置尚未确认，并给出恢复命令。检测到外部并发修改时会保留该修改。

多行 shell 命令字符串会完整保留，其中类似 Remark 管理标记的文字不会被当作配置结构。若快捷键值本身使用 TOML 多行字符串，也需要按上述方式手工合并。

**安装后保留此仓库目录**，Herdr 会直接链接它。默认配置文件：Windows 为 `%APPDATA%\herdr\config.toml`，macOS／Linux 为 `~/.config/herdr/config.toml`。`HERDR_CONFIG_PATH` 指定配置文件，`XDG_CONFIG_HOME` 覆盖配置根目录；Herdr 不在 `PATH` 中时可使用 `HERDR_BIN_PATH` 指定可执行文件。

## 使用

先聚焦目标 Agent。默认 `prefix` 是 `Ctrl+B`：先按下并松开，再按后一个键。

| 快捷键 | 操作 |
| --- | --- |
| `prefix+u` | 切换已读／未读 |
| `prefix+shift+u` | 在浮层中编辑简短备注 |

| 状态 | 灯 |
| --- | --- |
| 工作中 | 黄色 `●`，慢闪烁 |
| 阻塞／等待输入 | 红色 `●` |
| 空闲、已读 | 绿色 `○` |
| 完成未读或手动未读 | 蓝色 `●` |
| 未知 | 灰色 `·` |

新建或恢复的对话没有完成回合时默认**已读**，启动过程中短暂出现 working／blocked 也不会变成完成未读。同一终端内，Herdr 原生 `agent_session` 变化会清除前一会话的已读／未读标记；替换终端也一样。重载 Remark 会保留已有真实未读回合和手动标记。

Herdr 确认的真实完成回合会变**蓝色**，包括新会话的第一轮真实任务和当前 Tab 内的任务。单纯停留、新输出或普通信息刷新不算查看；确认已读只清除当前标记，下一轮完成仍会变蓝。working、blocked、unknown 均直接沿用 Herdr 状态，显示优先于未读灯。

普通刷新及短暂的 `unknown` 检测状态会保留已有已读记录。没有新生命周期序号的原生 `idle`／`done` 显示切换，不会产生新的完成回合。

已记录的原生完成回合跨短暂 `unknown` 保留。单纯从工作／阻塞返回空闲，不会在缺少原生完成信号时推断出新的未读回合。

```text
新建／恢复且没有完成任务 ────────→ 已读
新的完成回合／手动标记 ──────────→ 未读
未读 ── 查看操作 ──────────────→ 已读
         ├─ 未读快捷键
         ├─ 离开后重新聚焦 pane
         ├─ 终端回滚位置实际变化
         ├─ 支持的内容区滚轮操作
         └─ 保存／清空备注：当前 Agent

working → 黄灯；blocked → 红灯；unknown → 灰点
idle / done → 未读为蓝色 ●，已读为绿色 ○
```

Tab 改名只更新显示名称，包含其他插件触发的自动改名，不确认已读。每次状态刷新重新核对目录、Tab 名和 Git 分支；监控周期核对已有灯色与原生状态，不确认已读。

备注依次取当前 pane 名、Agent 摘要或会话标题作为初始值。`Enter` 保存，清空后按 `Enter` 删除，`Ctrl+C` 取消；最多 80 个 Unicode 字符，会替换原生 pane 名。保存只确认改名前观察到的回合，保存期间新完成的一轮或新手动标记仍保留未读；Agent 已退出、或编辑期间 Herdr 上报的会话已切换时停止保存。在快捷键之外给 pane 改名后，下次聚焦或 Agent 事件会刷新显示。

## 配置

查询插件配置目录：

```sh
herdr plugin config-dir huluhlu.agent-inform
```

在该目录创建 UTF-8 编码的 `config.json`（支持带 BOM 的文件），所有配置均可选：

```json
{ "blink": true, "blink_interval_ms": 800, "wheel_read": true }
```

| 配置 | 行为 |
| --- | --- |
| `blink` | false 时工作灯常亮，仍保留滚动已读。 |
| `blink_interval_ms` | 闪烁间隔，限制为 100–60000 毫秒，默认 800。 |
| `wheel_read` | 启用支持宿主的共用 Windows 滚轮监听；false 时仍保留公开终端回滚识别。 |

配置在监控下一轮生效；监控已退出时执行 `npm run init`。每个 Herdr 服务端按实际 API socket 自动隔离监控，插件配置仍然共享。原生辅助进程仅在存在未读 pane 时运行；没有未读 pane 或需要闪烁的工作灯时，该服务端的监控也会退出。颜色是静态配置，可在 Herdr 侧栏配置中调整。

原生辅助进程退出或验证超时后，共用监控会自动重试，两次启动至少间隔 5 秒。

修改快捷键时，替换 Herdr 配置中 `# herdr-remark begin`／`end` 区块内已有的 `key`，不要重复追加。执行 `herdr config check` 校验，再执行 `herdr server reload-config` 应用。

## 更新

在此仓库中执行：

```sh
git pull --ff-only
herdr plugin link .
npm run init
```

初始化会等待 Herdr 的刷新动作完成，并重载已有监控，不重启 Agent。重新运行安装器会用示例默认值替换管理区块，包括快捷键和颜色；保留自定义配置请使用上述更新命令。

## 排查问题

- **Agent 缺失或工作／阻塞状态不正确：** 查看 `herdr agent explain <pane_id>` 和 [Herdr 检测说明](https://herdr.dev/docs/agents/)。Remark 只写自己的元数据，不报告执行状态，也不清除 Agent authority。
- **应用内部滚动仍是蓝色：** 先核对[宿主支持与验证情况](#终端与-shell)。需匹配前台窗口、实际聚焦 pane、可见内容和内容区坐标。锁屏／后台窗口、匹配歧义或文字不足时保留未读；WezTerm 可尝试内容区中部，并确认同目录 CLI 能连接 GUI。无法匹配时可用其他查看操作清除。监听不吞掉或注入鼠标输入、不读取键盘；文本只经本地管道在内存中比对，不保存或记入日志。
- **监听停止：** 执行 `npm run init`。只诊断输入可运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/probe-scroll.ps1 -Seconds 30`；该限时探针不改变已读状态、不读取对话文本。
- **刷新失败：** 查看 `herdr plugin log list --plugin huluhlu.agent-inform`；确认已有服务器的插件环境能找到 Node.js、Git 和 Herdr。修正后重新执行 `npm run init`。

已知接口边界：同终端切换对话依赖 Herdr 上报变化的 `agent_session`；若没有身份或暂时仍上报旧身份，Remark 此时无法识别 `/new`。聚焦事件没有原始序号和用户／插件来源，仍符合当前状态的迟到事件无法总是区分。不同会话显示完全相同内容时，屏幕匹配无法可靠区分。滚到边界后继续滚轮仍算查看。Herdr 服务器重启后已读标记重置，原生 pane 备注由 Herdr 保存。

## 开发

```sh
npm test
```

沿用 Node 测试框架，不额外安装包或 Agent。Windows 测试原生辅助进程启动、UTF-8 协议和输入管道关闭后的退出；macOS／Linux 测试带空格路径及 `CDPATH` 下的 POSIX 安装入口。测试临时文件用后清理。反馈问题时请提供操作系统、终端、Herdr／Node／Agent 版本和复现步骤，并移除对话内容及私有路径。

插件身份和最低 Herdr 版本来自 `herdr-plugin.toml`，Node 要求来自 `package.json`，安装快捷键来自 `config.example.toml`。Herdr 固定的接口文字上限集中定义于 `src/text.js`，不额外分片绕过超长限制。监控路径由注入的状态目录和 socket 身份推导，不依赖特定机器、仓库位置、分支或 Agent 名称。

[更新记录](CHANGELOG.md) · [问题反馈](https://github.com/huluhuluu/herdr-remark/issues) · [MIT 许可证](LICENSE)
