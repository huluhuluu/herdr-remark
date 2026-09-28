# Remark

两个快捷键，管理 Herdr Agent 的已读状态和简短备注。Node.js 18+，无依赖、无构建步骤。

| 快捷键 | 操作 |
| --- | --- |
| `prefix+u` | 切换当前 Agent 的 `read / unread`，再次进入它时恢复 `read` |
| `prefix+shift+u` | 编辑备注：Enter 保存，空行清除，Ctrl-C 取消 |

保留 Herdr 原生状态灯，旁边的 `read / unread` 使用内置 `state_text`，自动与状态灯使用同一主题颜色：工作中为黄色，阻塞为红色，完成为青绿色，空闲为绿色。自定义主题同样生效，插件不修改 Agent 的实际运行状态。

备注编辑器优先填入已有 pane 名称，其次使用 Agent 提供的 `$summary`、会话标题。没有标题或摘要时留空，不调用模型生成摘要。备注最多 80 个 Unicode 字符，作为 Herdr 的原生 pane 名称保存，因此会跟随 pane 移动和 Herdr 会话恢复。已有的自定义 pane 名称也会在这个编辑器中修改。

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

新启动的会话会自动初始化 `read / unread`。若在已有会话中安装，可在插件目录执行 `npm run init`，或直接使用快捷键；新检测到的 Agent 和再次聚焦的 Agent 也会自动初始化。

## 行为

- 标为未读后，当前停留不会立即清除；离开后再次进入会清除。
- Herdr 原生的 `done` 显示为 `unread`，查看后由 Herdr 自行恢复。
- 编辑备注不会主动标为未读。关闭备注窗口后重新聚焦 Agent，会按正常聚焦规则标为已读。
- 未读标记是本次 Herdr 运行期间的显示元数据，服务器冷重启后重置；备注由 Herdr 持久保存。
- 颜色反映 Agent 的实际状态，而非强制让所有 `unread` 都变绿。
- 不提供原生侧边栏右键菜单；目前 Herdr 没有开放这个插件入口。
- 状态文字由本插件设置；不要同时安装另一款修改 `state_labels` 的插件。

没有收件箱、自动通知、排序、轮询后台进程或插件状态数据库。运行代码只有 `src/herdr.js`、`src/remark.js`、`src/note-editor.js`。

插件 ID 沿用 `huluhlu.agent-inform`，保持已有安装兼容。仓库名为 `herdr-remark`，不添加市场发现标签。旧版本的 `$inform` 行和其他快捷键应替换为上述配置；旧备注不会被删除，仍在原来的插件 `state.json` 中。

## 验证

```sh
npm test
```

MIT License.
