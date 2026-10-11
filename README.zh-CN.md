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

| 运行环境 | 状态、备注、快捷键 | 终端回滚→已读 | 全屏应用内滚轮→已读 |
| --- | --- | --- | --- |
| Windows＋Windows Terminal | 支持 | 支持 | 支持，使用只读原生监听 |
| Windows＋其他终端 | 支持 | 支持 | 尚未实现 |
| macOS | 支持 | 支持 | 尚未实现 |
| Linux | 支持 | 支持 | 尚未实现 |
| SSH／远端服务器 | 通过目标服务器 API | Herdr 报告回滚变化时支持 | 需要监听器和终端桌面位于同一台机器 |

要求 **Herdr 0.8.2+、Node.js 18+ 和 Git**，且 Herdr 插件进程能够找到这些可执行文件。推荐 Herdr 0.9.1+，包含原生聚焦事件修复；新版接口提供 `completion_seq` 时自动使用，无需针对版本增加适配器。

Windows Terminal 滚动已读已在 Herdr 0.9.1 会话中确认可用。CI 覆盖 Windows、macOS、Linux 和 Node.js 18/20/22/24；Agent 接口回归测试包含 Codex、Claude Code、DST／`dsh-tui`、OpenCode、Copilot 及任意自定义名称。测试验证的是统一 API 行为，**不代表逐一安装、实测了所有 Agent 和终端**。原生 macOS／Linux 桌面交互尚未手工验证。

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

安装器校验配置，在有变化时备份，链接插件并添加侧栏与快捷键。无关配置会保留；遇到管理区块外已有的侧栏／快捷键冲突时停止。此时手工合并 [config.example.toml](config.example.toml)，再执行 `herdr plugin link .` 和 `npm run init`。已有 `rows_by_agent` 专用布局可能也需要手工加入相同 token。

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

每个观察到的完成回合都先变**蓝色**，包括当前 Tab。单纯停留、新输出或普通信息刷新不算查看；确认已读只清除当前标记，下一轮完成仍会变蓝。工作和阻塞状态优先显示。

```text
新的完成回合／手动标记 ──────────→ 未读
未读 ── 查看操作 ──────────────→ 已读
         ├─ 未读快捷键
         ├─ 离开后重新聚焦 pane
         ├─ 终端回滚位置实际变化
         ├─ 支持的内容区滚轮操作
         ├─ 保存／清空备注：当前 Agent
         └─ Tab 改名：该 Tab 下全部 Agent

working → 黄灯；blocked → 红灯；unknown → 灰点
idle / done → 未读为蓝色 ●，已读为绿色 ○
```

Tab 改名包含其他插件触发的自动改名。每次状态刷新重新核对目录、Tab 名和 Git 分支；闪烁间隔只更新灯。

备注依次取当前 pane 名、Agent 摘要或会话标题作为初始值。`Enter` 保存，清空后按 `Enter` 删除，`Ctrl+C` 取消；最多 80 个 Unicode 字符，会替换原生 pane 名。在快捷键之外给 pane 改名后，下次聚焦或 Agent 事件会刷新显示。

## 配置

查询插件配置目录：

```sh
herdr plugin config-dir huluhlu.agent-inform
```

在该目录创建 `config.json`，所有配置均可选：

```json
{ "blink": true, "blink_interval_ms": 800, "wheel_read": true }
```

| 配置 | 行为 |
| --- | --- |
| `blink` | false 时工作灯常亮，仍保留滚动已读。 |
| `blink_interval_ms` | 闪烁间隔，限制为 100–60000 毫秒，默认 800。 |
| `wheel_read` | 启用 Windows Terminal 滚轮监听；false 时仍保留公开终端回滚识别。 |

配置在监控下一轮生效；监控已退出时执行 `npm run init`。原生辅助进程仅在存在未读 pane 时运行；没有未读 pane 或需要闪烁的工作灯时，共用监控也会退出。颜色是静态配置，可在 Herdr 侧栏配置中调整。

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
- **全屏滚动仍是蓝色：** 原生监听目前仅支持 Windows Terminal，需匹配前台窗口、实际聚焦 pane、可见内容和内容区坐标。锁屏／后台窗口、匹配歧义或文字不足时保留未读，可用其他查看操作清除。监听不吞掉或注入鼠标输入、不读取键盘；文本只经本地管道在内存中比对，不保存或记入日志。
- **监听停止：** 执行 `npm run init`。只诊断输入可运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/probe-scroll.ps1 -Seconds 30`；该限时探针不改变已读状态、不读取对话文本。
- **刷新失败：** 查看 `herdr plugin log list --plugin huluhlu.agent-inform`；确认已有服务器的插件环境能找到 Node.js、Git 和 Herdr。修正后重新执行 `npm run init`。

已知接口边界：旧版 Herdr 只能通过已观察到的工作／阻塞→空闲转换推断当前 Tab 的完成，不能从空闲快照补回遗漏回合。聚焦／改名事件没有原始序号和用户／插件来源，仍符合当前状态的迟到事件无法总是区分。不同会话显示完全相同内容时，屏幕匹配无法可靠区分。滚到边界后继续滚轮仍算查看。Herdr 服务器重启后已读标记重置，原生 pane 备注由 Herdr 保存。

## 开发

```sh
npm test
```

沿用 Node 测试框架，不额外安装包或 Agent。Windows 测试原生辅助进程启动、UTF-8 协议和输入管道关闭后的退出；macOS／Linux 测试带空格路径及 `CDPATH` 下的 POSIX 安装入口。测试临时文件用后清理。反馈问题时请提供操作系统、终端、Herdr／Node／Agent 版本和复现步骤，并移除对话内容及私有路径。

[更新记录](CHANGELOG.md) · [问题反馈](https://github.com/huluhuluu/herdr-remark/issues) · [MIT 许可证](LICENSE)
