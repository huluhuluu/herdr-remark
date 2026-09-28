# Remark

两个快捷键，管理 Herdr Agent 的已读状态和简短备注。Node.js 18+，无依赖、无构建步骤。

| 快捷键 | 操作 |
| --- | --- |
| `prefix+u` | 切换手动未读，离开后再次进入清除；原生后台完成也可标为已读 |
| `prefix+shift+u` | 编辑备注：Enter 保存，空行清除，Ctrl-C 取消 |

保留 Herdr 原生状态灯和运行状态，手动未读时额外显示绿色 `● unread`，不会覆盖工作或阻塞状态。第一行是「状态\|Tab 名\|Git 分支」，第二行仅显示 pane 名称 / 备注。例如：

```text
● blocked|项目|main · ● unread
等待确认接口参数
```

原生灯及状态文字沿用主题配色：`working` 工作中、`blocked` 等待批准或输入（红色）、`read` 已读空闲、`unread` 后台完成未查看、`unknown` 无法识别。额外未读灯固定绿色，可修改配置中的 `fg`。再次进入后只清除额外未读灯，不改变 Agent 的工作或阻塞状态。

无 Git 分支时省略该段；分支在聚焦、运行状态变化或切换未读时刷新，不启动轮询。状态、Tab、分支合并为一个原生文字项，用无空格的 `|` 分隔；额外未读项前的 ` · ` 是 Herdr 固定间距，插件无法修改。

备注在 64 列 × 7 行的小浮层中编辑，不创建或切换 pane。优先填入已有 pane 名称，其次使用 Agent 提供的 `$summary`、会话标题。没有标题或摘要时留空，不调用模型生成摘要。备注最多 80 个 Unicode 字符，作为 Herdr 的原生 pane 名称保存，因此会跟随 pane 移动和 Herdr 会话恢复。已有的自定义 pane 名称也会在这个编辑器中修改。

## 安装

需要 Git、Node.js 18+ 和 Herdr 0.8.2+；推荐 Herdr 0.9.1，包含聚焦事件修复。

```sh
herdr plugin install huluhuluu/herdr-remark
```

本地开发：

```sh
git clone https://github.com/huluhuluu/herdr-remark
cd herdr-remark
herdr plugin link .
```

将 [config.example.toml](config.example.toml) 的侧边栏和两个快捷键合并到 Herdr 的 `config.toml`，再执行：

```sh
herdr config check
herdr server reload-config
```

新启动的会话会自动初始化状态。若在已有会话中安装，可在插件目录执行 `npm run init`，或直接使用快捷键。升级时同步替换侧边栏 `rows` 配置；若配置了 `rows_by_agent`，也需同步修改。Tab 重命名和 pane 移动会自动更新显示。

## 行为

- 标为未读后，当前停留不会立即清除；离开后再次进入会清除。
- Herdr 原生的 `done` 显示为 `unread`，查看后由 Herdr 自行恢复。
- 打开、保存或取消备注浮层不会切换 pane，也不会主动改变已读状态。
- 未读标记是本次 Herdr 运行期间的显示元数据，服务器冷重启后重置；备注由 Herdr 持久保存。
- 工作/阻塞灯和手动未读灯可同时显示，互不覆盖。
- 不提供原生侧边栏右键菜单；目前 Herdr 没有开放这个插件入口。
- 仅一个 `remark_unread` 元数据标记；原生 `state_labels` 用于紧凑显示。不要同时安装另一款修改状态文字的插件。

没有收件箱、自动通知、排序、轮询后台进程或插件状态数据库。运行代码只有 `src/herdr.js`、`src/remark.js`、`src/note-editor.js`。

插件 ID 沿用 `huluhlu.agent-inform`，保持已有安装兼容。仓库名为 `herdr-remark`，不添加市场发现标签。旧版本的 `$inform` 行和其他快捷键应替换为上述配置；旧备注不会被删除，仍在原来的插件 `state.json` 中。

## 验证

```sh
npm test
```

MIT License.
