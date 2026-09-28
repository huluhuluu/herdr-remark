# Remark

两个快捷键，管理 Herdr Agent 的已读状态和简短备注。Node.js 18+，无依赖、无构建步骤。

| 快捷键 | 操作 |
| --- | --- |
| `prefix+u` | 切换手动未读，离开后再次进入清除；原生后台完成也可标为已读 |
| `prefix+shift+u` | 编辑备注：Enter 保存，空行清除，Ctrl-C 取消 |

插件在原状态灯位置绘制一个合并状态灯。工作中、阻塞和未知状态沿用 Herdr 的符号与颜色；空闲已读为绿色空心圆 `○`，空闲未读为蓝色实心圆 `●`。第一行显示「状态灯 目录名 · Tab 名」，第二行显示「Git 分支 · 备注」。

```text
● herdr-inform · 24
main · 等待确认接口参数
```

未读不显示 `read/unread` 文字。再次进入后恢复普通空闲灯，不改变 Agent 的工作或阻塞状态。灯和目录名同色，中间只留一个空格；Tab、分支和备注独立着色。

灯采用 Herdr 默认 Catppuccin 的静态 dots 配色：工作黄、阻塞红、空闲绿、未知灰，空闲未读蓝。配置中的 `fg` 可调整；不会自动跟随主题切换，也不模拟动画。

无 Git 分支或备注时省略对应项；事件触发刷新，不启动轮询。灯和目录名合并为一个显示项，避免点间隔；Tab 和第二行各项之间保留 Herdr 的 ` · ` 分隔符。

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
- Herdr 原生的 `done` 视为空闲未读，显示蓝灯，查看后由 Herdr 自行恢复。
- 打开、保存或取消备注浮层不会切换 pane，也不会主动改变已读状态。
- 未读标记是本次 Herdr 运行期间的显示元数据，服务器冷重启后重置；备注由 Herdr 持久保存。
- 工作和阻塞状态保持原灯；只有空闲未读使用蓝色灯。
- 不提供原生侧边栏右键菜单；目前 Herdr 没有开放这个插件入口。
- 仅维护未读标记和显示 token，不修改 Agent 生命周期状态。不要同时安装另一款修改状态显示的插件。

没有收件箱、自动通知、排序、轮询后台进程或插件状态数据库。运行代码只有 `src/herdr.js`、`src/remark.js`、`src/note-editor.js`。

插件 ID 沿用 `huluhlu.agent-inform`，保持已有安装兼容。仓库名为 `herdr-remark`，不添加市场发现标签。旧版本的 `$inform` 行和其他快捷键应替换为上述配置；旧备注不会被删除，仍在原来的插件 `state.json` 中。

## 验证

```sh
npm test
```

MIT License.
