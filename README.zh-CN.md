# herdr-remark

[English](README.md) | **简体中文**

用两个快捷键，为 Herdr Agent 标记已读／未读、编辑简短备注，无需离开当前 pane。无 npm 依赖，无构建步骤。

![侧边栏布局与备注浮层示意](docs/images/preview.svg)

*上图为布局示意，非实际截图。* 第一行：状态灯 + 目录名 · Tab 名；第二行：Git 分支 · 备注，空项自动隐藏。灯与目录同色，其他字段独立着色。

## 安装

需要 **Herdr 0.8.2+、Node.js 18+ 和 Git**，均需位于 `PATH`。推荐使用包含聚焦事件修复的 Herdr 0.9.1+。在已启动的 Herdr 会话内执行：

```sh
git clone https://github.com/huluhuluu/herdr-remark.git
cd herdr-remark
```

**Windows · PowerShell**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

**Linux · Bash**

```bash
bash scripts/install.sh
```

脚本备份并校验配置、链接插件、配置侧边栏和快捷键。**安装后请保留仓库目录。** 命令末尾加 `--check` 可仅校验。如果已有侧边栏或快捷键配置冲突，请手工合并 [config.example.toml](config.example.toml)，再运行 `herdr plugin link .` 和下方重载命令。

## 使用

先聚焦目标 Agent。默认 `prefix` 为 `Ctrl+B`：先按下并松开，再按后一个键。

| 快捷键 | 操作 |
| --- | --- |
| `prefix+u` | 切换已读／未读 |
| `prefix+shift+u` | 在小浮层中编辑备注 |

**未读：** 标记后停留在当前 Agent 不会清除；离开再返回自动清除，也可再次按快捷键清除。工作和阻塞状态优先于未读显示。

| 状态 | 灯 |
| --- | --- |
| 工作中 | 黄色 `●` |
| 阻塞／等待输入 | 红色 `●` |
| 空闲、已读 | 绿色 `○` |
| 空闲、未读／后台完成未查看（`done`） | 蓝色 `●` |
| 未知 | 灰色 `·` |

**备注：** 依次使用已有 pane 名称 → Agent 摘要 → 会话标题作为初始内容。`Enter` 保存，清空后按 `Enter` 删除，`Ctrl+C` 取消。最多 80 个 Unicode 字符，保存为原生 pane 名称，会替换已有自定义名称。

## 修改快捷键

编辑 Herdr **实际使用的 `config.toml`**，Windows 通常为 `%APPDATA%\herdr\config.toml`，Linux 为 `~/.config/herdr/config.toml`。路径优先使用 `HERDR_CONFIG_PATH`，其次为 `XDG_CONFIG_HOME/herdr/config.toml`。

找到下列两个已有绑定（脚本安装时位于 `# herdr-remark begin` / `end` 内），仅修改 `key`。例如将 `u` 改为 `r`：**替换原条目，不要重复追加**，并选用未被占用的按键。

```toml
[[keys.command]]
key = "prefix+r"
type = "plugin_action"
command = "huluhlu.agent-inform.toggle-unread"

[[keys.command]]
key = "prefix+shift+r"
type = "plugin_action"
command = "huluhlu.agent-inform.note"
```

校验并应用修改：

```sh
herdr config check
herdr server reload-config
```

手工安装或更新代码后，在仓库目录再运行 `npm run init`。更新代码使用 `git pull --ff-only`；重新执行安装脚本会将管理区块内的快捷键和颜色恢复为示例默认值。

## 说明

- Herdr 服务器重启后未读标记重置，备注由 Herdr 持久保存。
- 状态灯使用静态 Catppuccin 配色，不包含动画，也不自动跟随主题；可修改侧边栏配置中的 `fg`。
- Git 分支在聚焦、Agent 事件发生时刷新；无后台轮询，不提供原生侧边栏右键菜单。
- Herdr 未提供 pane 重命名事件，因此在快捷键之外改名（其他工具或第二个客户端）后，侧边栏会保留旧备注，直到下一次聚焦或 Agent 事件。
- 已在 Windows 验证；Bash 安装脚本已通过 Git Bash 检查，尚未在原生 Linux 验证。

开发测试：`npm test`；修改 manifest 后重新运行 `herdr plugin link .`。

[更新记录](CHANGELOG.md) · [问题反馈](https://github.com/huluhuluu/herdr-remark/issues) · [MIT 许可证](LICENSE)
