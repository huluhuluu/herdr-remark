# Changelog

## 0.2.0 — 2026-09-05

Fixes the two things that made a sidebar mark unusable in practice.

### Changed

- **`auto_clear_on_focus` is now tri-state**: `"auto"` (new default), `"always"`, `"never"`.
  Under `"auto"`, focusing a pane clears only entries the plugin auto-flagged from a status
  change *and* that carry no remark. Anything you marked or annotated yourself survives
  until you clear it explicitly.

  This was the bug: clicking an agent's sidebar row focuses that pane, so the old
  unconditional clear destroyed the mark at the exact moment you reached for it. Existing
  configs with `true`/`false` keep working and mean `"always"`/`"never"`.
- **`Enter` in the inbox marks read instead of clearing**, keeping the remark. The remark is
  usually why you went there. `c` still clears.
- **`notify_on_manual_mark` now defaults to `true`, and fires in both directions.** Marking
  and unmarking each raise a popup naming the pane. A keybinding otherwise gives no
  confirmation that it ran, which makes a working binding and a broken one look identical.

### Added

- **`unread_text` option**, default `未读`, shown after the marker when a pane is flagged
  but carries no remark.

  Second half of the same reported bug: with no remark the `$inform` row rendered as a lone
  `●`, directly under the `state_icon` row — also a dot. Toggling unread produced no visible
  change in the sidebar and no popup, so the feature looked dead while working correctly.
  Set to `""` for the old bare dot.

- **`agents` action** and an all-agents mode in the inbox, toggled with `tab`. Lists every
  running agent, unread first, so you can flag one you are not focused on. Untracked rows
  offer `[跳转] [标未读] [备注]`; the current pane is marked `← 当前`.

  Herdr gives plugins no way to act on the agent highlighted in its sidebar — the plugin
  context carries the *focused* pane only, and `api snapshot` exposes just `focused`. The
  picker is the stand-in for that missing entry point.
- Opening the inbox with nothing flagged starts in the all-agents list rather than showing
  an empty screen.
- The inbox keeps the cursor on the same agent across a refresh or a mode switch.
- **Inline remark editing in the inbox.** `e` and `[备注]` now edit in place instead of
  handing off to the `note-editor` overlay: `Enter` saves and marks unread, an empty line
  drops the remark, `Esc` changes nothing, and the cursor stays where it was.

  The handoff was a second pane spawn on the hottest path, and a failed spawn closed the
  inbox too — indistinguishable from "editing a remark does nothing". `note-editor` is still
  what `prefix+shift+u` opens outside the inbox.

### Fixed

- `openPane()` **raises Herdr's error instead of returning `null`.** Every caller treated a
  silent `null` as success, so a pane that refused to open reported "editor opened" and then
  nothing appeared.
- The inbox no longer closes itself when a remark editor fails to open; it stays up and shows
  the reason.
- The input decoder consumes whole code points rather than UTF-16 code units, so a remark can
  hold characters outside the BMP without being cut in half.

## 0.1.0 — 2026-09-04

First release. Verified against herdr `0.8.2-khanhtd36.1` on Windows 11 with Node 24.

### Added

- Per-pane unread flag and one-line remark, stored durably in
  `HERDR_PLUGIN_STATE_DIR/state.json` and projected onto Herdr pane metadata tokens
  (`unread` for logic, `inform` for display as `$inform`).
- Seven actions: `toggle-unread`, `note`, `note-from-selection`, `clear`, `inbox`,
  `clear-all`, `status`.
- Remark editor overlay pane, prefilled with any existing remark; an empty line drops the
  remark, Ctrl-C changes nothing.
- Inbox overlay pane driven by both keyboard and mouse: per-row buttons, a right-click
  context menu, and wheel scrolling, using SGR mouse reporting plus
  `herdr pane input --right-click pane`.
- Event hooks: `pane.agent_status_changed` auto-flags configured statuses and raises a
  desktop popup, `pane.focused` clears the flag while keeping the remark, `pane.closed`
  drops the entry.
- Startup hook that re-reports every token after a server restart, since tokens are
  ephemeral in the server, and drops entries whose pane is gone.
- Optional Agents view via `agent.view.set` that floats unread agents to the top.
- Config file with `auto_mark_on`, `auto_mark_when_focused`, `auto_clear_on_focus`,
  `notify_on_auto_mark`, `notify_on_manual_mark`, `notify_sound`, `sort_unread_first`,
  `unread_marker`, `read_marker`, and `max_remark_width`.

### Notes

- Herdr 0.8.2 does not list plugin actions in its own right-click menus, so mouse support
  is provided inside the plugin's own inbox pane. See the README.
- Plugin panes are opened with an explicit `--cwd`: Herdr launches them in the
  canonicalised plugin root, which on Windows is an extended-length path that Node cannot
  resolve a relative main script against.
