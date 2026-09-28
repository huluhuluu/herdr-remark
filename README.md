# Agent Inform

Mark a Herdr agent **unread** and pin a short **remark** on its sidebar row, with a
desktop popup when an agent finishes or gets stuck.

Herdr tells you an agent's *state*. It does not remember what **you** wanted from that
agent. Agent Inform adds that missing half: a per-pane unread flag and a one-line note,
kept in a durable state file and projected onto the Agents sidebar as pane metadata
tokens.

```
● claude  proj/api          ● 等余额修复后再跑压测
  claude  proj/web
● claude  paper/spec        ● 核对汇率取整
● claude  monitor/logs      ● 未读
```

- Toggle unread on the focused agent pane, by keybinding.
- Attach a remark from a small overlay editor, or straight from a terminal selection.
- Auto-flag panes that go `done` or `blocked`, with a Windows/macOS/Linux popup.
- A mouse- and keyboard-driven **inbox** listing every unread agent and its remark.
- An **agent picker** for flagging an agent you are *not* looking at.
- Unread agents float to the top of the sidebar via a declarative Agents view.
- Marks you set yourself survive looking at the pane, so the sidebar works as a queue.

Requires Herdr **0.8.2+** and Node.js **18+** on the machine running the Herdr server.

## Install

```bash
herdr plugin install huluhlu/herdr-inform
```

Or for local development:

```bash
git clone https://github.com/huluhlu/herdr-inform
herdr plugin link ./herdr-inform
```

Nothing else is required — the plugin writes its own default config on first use. The two
sections below are what turn it from "working" into "useful".

## Wire up the keys

Herdr 0.8.2 has no plugin entries in its own right-click menus (see
[Mouse](#mouse-support-and-what-herdr-0-8-2-cannot-do)), so keybindings are the primary
way in. Add to `config.toml`:

```toml
[[keys.command]]
key = "prefix+u"
type = "plugin_action"
command = "huluhlu.agent-inform.toggle-unread"
description = "mark agent unread / read"

[[keys.command]]
key = "prefix+shift+u"
type = "plugin_action"
command = "huluhlu.agent-inform.note"
description = "mark unread + remark"

[[keys.command]]
key = "prefix+i"
type = "plugin_action"
command = "huluhlu.agent-inform.inbox"
description = "open unread inbox"

[[keys.command]]
key = "prefix+shift+i"
type = "plugin_action"
command = "huluhlu.agent-inform.clear"
description = "clear unread + remark"

[[keys.command]]
key = "prefix+shift+a"
type = "plugin_action"
command = "huluhlu.agent-inform.agents"
description = "pick an agent to flag"
```

Then `herdr server reload-config`. Pick chords that are free in your setup — Herdr's own
defaults already use `prefix+v`, `prefix+x`, `prefix+z`, `prefix+r`, and `prefix+b`.

## Show the remark in the sidebar

The remark is reported as a pane metadata token named `inform`. It is invisible until you
put `$inform` in an Agents sidebar row:

```toml
[ui.sidebar.agents]
rows = [
  ["state_icon", "workspace", "tab"],
  ["terminal_title_stripped"],
  [{ token = "$inform", fg = "#f9e2af", bold = true }],
]
```

Custom tokens must keep the `$` prefix inside the `token = ` form; `token = "inform"` is
rejected by `herdr config check`.

## Actions

| Action id | Title | Contexts | What it does |
| --- | --- | --- | --- |
| `toggle-unread` | Mark agent unread | pane, global | Flip unread on the focused pane. Clearing keeps an existing remark pinned. |
| `note` | Mark unread + remark | pane, global | Open the remark editor overlay for the focused pane. |
| `note-from-selection` | Remark from selection | selection, pane | Use the current terminal selection as the remark. |
| `clear` | Clear unread + remark | pane, global | Drop both for the focused pane. |
| `inbox` | Open unread inbox | global, pane | Open the inbox overlay. |
| `agents` | Pick an agent to flag | global, pane | Open the inbox on *every* running agent, flagged or not. |
| `clear-all` | Clear all unread | global | Drop unread and remarks everywhere. |
| `status` | Show inform status | global | Print state file, config file, socket, and every tracked pane. |

`note-from-selection` needs a selection in the invocation that reaches it. Invoked without
one it exits with a message pointing at the editor instead.

Run any of them by hand while debugging:

```bash
herdr plugin action invoke status --plugin huluhlu.agent-inform
```

## The inbox and the agent picker

Both are the same overlay pane in two modes, and `tab` switches between them:

- **Unread inbox** (`inbox`) — flagged agents only, newest first.
- **All agents** (`agents`) — every running agent, unread ones first, so you can flag one
  you are not looking at. Untracked rows show `[跳转] [标未读] [备注]`; there is nothing to
  mark read or clear yet. The row you are currently in is marked `← 当前`.

Opening `inbox` with nothing flagged lands you in the all-agents list rather than an empty
screen.

Keyboard:

| Key | Action |
| --- | --- |
| `j` / `k`, arrows | Move |
| `tab`, `a` | Switch between all agents and unread only |
| `Enter` | Jump to the pane, marking it read but keeping the remark |
| `space` | Toggle unread |
| `e` | Edit the remark inline, without leaving the inbox |
| `c` | Clear this entry |
| `C` | Clear everything |
| `r` | Refresh |
| `m` | Open the context menu at the cursor |
| `q`, `Esc` | Close |

Mouse: left-click a row to select it, left-click a button to run it, right-click a row for a
context menu, wheel to move the cursor.

`e` and `[备注]` edit the remark **in place** in the inbox — `Enter` saves and marks unread,
an empty line drops the remark, `Esc` changes nothing. The standalone `note-editor` overlay
is still what the `note` action and `prefix+shift+u` open when you are not in the inbox.
Editing inline means the common path spawns no second pane, so it cannot fail on pane
creation, and the cursor stays on the row you were editing.

`Enter` marks read rather than clearing, because the remark is usually the reason you went
there. Use `c` when you are actually finished with it.

### Why the picker exists

You cannot act on the agent highlighted in Herdr's own sidebar. A plugin action receives
`focused_pane_id`, `focused_pane_agent`, `focused_pane_status`, `selected_text`, and the
workspace/tab ids — there is no `selected_agent` or sidebar cursor in the plugin context,
and `herdr api snapshot` exposes only `focused`. The sidebar cursor is client-side TUI
state. Clicking a sidebar row *focuses* that pane, which is a different thing from
selecting it, so the picker is the plugin's stand-in for the entry point Herdr does not
offer.

## Mouse support, and what Herdr 0.8.2 cannot do

**Herdr 0.8.2 does not list plugin actions in its own right-click menus.** Its pane menu is
a fixed set (New tab, Rename pane, Split right, Split down, Zoom, Send right-clicks to
pane, Close pane, …) and the sidebar menu likewise; there is no plugins submenu and no
manifest field that adds one. The `contexts = ["pane" | "selection" | "global"]` field on
an action declares which invocation contexts it accepts — that is, whether Herdr hands it
a focused pane, a text selection, or nothing — not where it appears in the UI.

So this plugin owns mouse input **inside its own pane** instead. The inbox overlay enables
SGR (1006) mouse reporting and calls

```
herdr pane input <own pane id> --right-click pane
```

which asks Herdr to route right-clicks into the pane rather than opening Herdr's menu.
That is what makes the per-row buttons and the context menu work.

Two consequences worth knowing:

- While the inbox is open, Herdr's own drag-to-copy and right-click menu do not apply
  inside that pane. They come back when it closes; the plugin restores nothing because the
  pane is destroyed.
- Everything outside the inbox is keybinding-driven. If a future Herdr version exposes
  plugin actions in its menus, the actions here already declare the right contexts and will
  work unchanged.

## Automatic marking and popups

The `pane.agent_status_changed` hook flags a pane unread when its agent enters a status
listed in `auto_mark_on`, and fires a desktop popup. The `pane.focused` hook clears the
unread flag when you look at the pane, keeping any remark. The `pane.closed` hook drops
the entry.

Popups go through `herdr notification show`, so they obey Herdr's own delivery setting.
For native Windows/macOS/Linux desktop popups:

```toml
[ui.toast]
delivery = "system"
```

`off` disables popups, `herdr` shows in-app toasts, and `terminal` asks the outer terminal
to raise the notification.

## Configuration

`herdr plugin config-dir huluhlu.agent-inform` prints the directory; the file is
`config.json`, written with these defaults on first run:

```json
{
  "auto_mark_on": ["done", "blocked"],
  "auto_mark_when_focused": false,
  "auto_clear_on_focus": "auto",
  "notify_on_auto_mark": true,
  "notify_on_manual_mark": true,
  "notify_sound": "auto",
  "sort_unread_first": true,
  "unread_marker": "●",
  "read_marker": "",
  "unread_text": "未读",
  "max_remark_width": 40
}
```

| Key | Meaning |
| --- | --- |
| `auto_mark_on` | Agent statuses that auto-flag a pane. Any of `idle`, `working`, `blocked`, `done`, `unknown`. `[]` disables auto-marking. |
| `auto_mark_when_focused` | Auto-flag even the pane you are looking at. Usually pointless. |
| `auto_clear_on_focus` | What focusing a pane clears. `"auto"` (default) clears only auto-flagged entries with no remark, so a mark you set yourself survives being looked at. `"always"` clears any unread. `"never"` never clears. Pre-0.2.0 `true`/`false` still work and mean `"always"`/`"never"`. |
| `notify_on_auto_mark` | Popup on automatic flagging. |
| `notify_on_manual_mark` | Popup when you flag by hand, in **both** directions. On by default: a keybinding gives no other confirmation that it fired, so a silent no-op is indistinguishable from a broken binding. |
| `notify_sound` | `auto` (finish chime for `done`, attention chime otherwise), `none`, `done`, or `request`. |
| `sort_unread_first` | Install the Agents view that floats unread agents to the top. |
| `unread_marker` / `read_marker` | Prefix on `$inform`. Set both to `""` for the bare remark. |
| `unread_text` | Shown after the marker when a pane is flagged but has **no** remark. Defaults to `未读`, because a lone `●` sits under `state_icon` — also a dot — and pressing the toggle key then produces no visible change at all. `""` restores the bare dot. |
| `max_remark_width` | Display width cap for `$inform`, in terminal columns (CJK counted as 2). |

## How it stores things

State lives in `HERDR_PLUGIN_STATE_DIR/state.json` and is the source of truth. Pane
metadata tokens are only a projection of it, because tokens are ephemeral in the Herdr
server and do not survive a cold restart. The `[[startup]]` hook waits for pane
restoration, re-reports every token, drops entries whose pane is gone, and reinstalls the
Agents view.

Two tokens are reported per pane, both under source `plugin:huluhlu.agent-inform`:

- `unread` — `"1"` while unread, cleared otherwise. Logic only: the Agents view sorts on
  it. Not meant for a sidebar row.
- `inform` — the visible string, marker plus remark, truncated to `max_remark_width`.

Concurrent event hooks are serialised with a directory lock and a temp-file rename, so two
hooks firing at once cannot corrupt the file.

The sidebar ordering uses `agent.view.set`, which has no CLI wrapper, so it goes over the
Herdr socket directly. If that call fails the plugin logs it and carries on — tokens and
state are already correct without it; only the ordering is lost.

## Troubleshooting

`herdr plugin action invoke status --plugin huluhlu.agent-inform` prints the resolved
state file, config file, socket target, and every tracked pane.

`herdr plugin log list` shows each action and event-hook run with its exit code, stdout,
and stderr. Note that **pane commands are not logged** — if an overlay misbehaves, run its
script directly in a normal pane instead:

```bash
node src/inbox-view.js
```

Read back what Herdr actually holds for a pane:

```bash
herdr pane get <pane_id>    # includes the tokens map
```

`herdr pane list` and `herdr api snapshot` do **not** include tokens.

### Overlays that open and immediately die

`[[panes]]` has no `cwd` field, and Herdr launches a plugin pane in the *canonicalised*
plugin root, which on Windows is an extended-length path (`\\?\D:\...`). Node cannot
resolve a relative main script against such a cwd, so `["node", "src/inbox-view.js"]` never
starts. This plugin's own `openPane()` therefore always passes an explicit `--cwd` with the
prefix stripped. Open the overlays through the plugin's actions; opening an entrypoint by
hand with a bare `herdr plugin pane open` will fail on Windows unless you add `--cwd`
yourself.

## Development

```
src/cli.js            action dispatcher; every [[actions]] entry routes here
src/note-editor.js    remark editor overlay pane
src/inbox-view.js     inbox / agent picker overlay pane, keyboard + mouse
src/core.js           mark/clear/render logic and token projection
src/state.js          durable state and config, with locking
src/herdr.js          Herdr access layer: CLI transport + socket transport
src/event.js          shared event-hook plumbing
src/on-*.js           event hooks
src/startup.js        token re-report and view reinstall after a server restart
src/ansi.js           escape sequences
```

No dependencies, no build step. `min_herdr_version` is set to `0.8.2` conservatively —
that is the version everything here was verified against, not necessarily the earliest that
works.

## License

MIT. See [LICENSE](LICENSE).
