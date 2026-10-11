# herdr-remark

**English** | [简体中文](README.zh-CN.md)

Two shortcuts to mark Herdr agents read/unread and edit short notes, without leaving the current pane. No npm dependencies or build step.

![Sidebar layout and note popup illustration](docs/images/preview.svg)

*Layout illustration, not a screenshot.* First row: status light + directory · tab. Second row: Git branch · note; empty fields are hidden. The light and directory share a color; other fields are styled independently.

## Install

Requires **Herdr 0.8.2+, Node.js 18+ and Git** on `PATH`. Herdr 0.9.1+ is recommended for focus event fixes. Run inside a running Herdr session:

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

The script backs up and validates the config, links the plugin, and configures the sidebar and shortcuts. **Keep this checkout after installation.** Add `--check` to validate only. If existing sidebar settings or shortcuts conflict, merge [config.example.toml](config.example.toml) manually, then run `herdr plugin link .` and the reload commands below.

## Use

Focus the target agent first. The default `prefix` is `Ctrl+B`: press and release it, then press the next key.

| Shortcut | Action |
| --- | --- |
| `prefix+u` | Toggle read / unread |
| `prefix+shift+u` | Edit a note in a small popup |

**Unread:** staying in the agent keeps the mark. A real terminal scrollback movement, leaving and returning, toggling again, saving a note, or renaming its Tab clears unread. A Tab rename acknowledges all agents in that Tab. Output growth and resizing do not count as reading. A viewed completion shows green `○`; the next completion shows blue `●` again. Working and blocked states take priority over unread.

**Completion tracking:** every observed completion starts blue, including in the active Tab. When available, Herdr's `completion_seq` identifies the completed round independently of its native seen state. Older versions use observed working/blocked → idle transitions; an idle snapshot alone cannot recover work completed while the plugin was absent. Acknowledging a round never calls native `agent focus` or changes another agent's lifecycle.

**Scroll scope:** the plugin subscribes to Herdr terminal scrollback events. In Herdr 0.9.1, a fullscreen agent can receive wheel input directly while the terminal scrollback offset stays at zero. Such internal scrolling is not yet detected. An external input hook is under investigation; the plugin does not require a patched Herdr.

**Event limits:** Herdr's focus/rename events carry neither an original sequence nor a user/plugin origin. Hooks for a pane that is no longer focused or a superseded Tab name only refresh metadata. A late event that still matches current state cannot always be distinguished from a new interaction. Automatic Tab renames also acknowledge unread, just like manual ones.

| State | Light |
| --- | --- |
| Working | Yellow `●`, pulsing |
| Blocked / awaiting input | Red `●` |
| Idle, read | Green `○` |
| Unread (manual mark, or a finished turn) | Blue `●` |
| Unknown | Gray `·` |

**Working blink:** the yellow light and directory text pulse together, enabled by default. The plugin alternates bright and dim tokens over the API socket. Animation and scroll-to-read share one monitor, which exits when there are no animated working lights or unread panes. Disabling blink leaves a steady yellow light and keeps scroll-to-read available.

To turn it off or change the speed, create `config.json` in this plugin's config directory (`herdr plugin list` prints the path, usually `%APPDATA%\herdr\plugins\config\huluhlu.agent-inform`):

```json
{ "blink": false, "blink_interval_ms": 400 }
```

Both keys are optional. `blink_interval_ms` is clamped to 100–60000 and defaults to 800. A running monitor applies changes on its next cycle; run `npm run init` if the monitor has already exited. The pulse needs the dimmed `$remark_lamp_working_blink` token in your sidebar rows — rerun the installer if it is missing.

**Notes:** prefill the existing pane name → agent summary → conversation title. `Enter` saves, empty input + `Enter` clears, and `Ctrl+C` cancels. Notes are limited to 80 Unicode characters and saved as native pane names, replacing any existing custom name.

## Change shortcuts

Edit Herdr's **active `config.toml`**, usually `%APPDATA%\herdr\config.toml` on Windows or `~/.config/herdr/config.toml` on Linux. `HERDR_CONFIG_PATH` takes precedence, followed by `XDG_CONFIG_HOME/herdr/config.toml`.

Find the two existing bindings below (inside `# herdr-remark begin` / `end` for script installs). Change only their `key` values; for example, use `r` instead of `u`. **Replace the existing entries; do not append duplicates.** Choose unused keys.

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

Validate and apply your changes:

```sh
herdr config check
herdr server reload-config
```

After manual installation or a code update, run `herdr plugin link .`, then `npm run init` from the checkout. The latter invokes Herdr's `refresh` plugin action using the actual plugin directories, waits for initialization to finish, and asks an existing monitor to release its lock and restart with the new code on its next cycle. Update with `git pull --ff-only`; rerunning the installer resets shortcuts and colors in its managed block to the example defaults.

## Notes

- Normal refreshes only write Remark metadata; the plugin does not scan processes or clear agent authority.
- Unread marks reset when the Herdr server restarts; notes persist through Herdr.
- Lights use static Catppuccin colors, matching no theme automatically. Edit `fg` values in the sidebar config to customize them.
- Every status refresh resolves the current directory, Tab name and Git branch. Renaming a Tab refreshes all its agents. Animation ticks only update lamps; scroll events use a socket subscription. There is no native sidebar right-click menu.
- Herdr exposes no event for pane renames, so a pane renamed outside the shortcut (another tool, or a second client) keeps its old note in the sidebar until the next focus or agent event.
- Windows has been tested; the Bash installer has been checked under Git Bash, but native Linux has not been tested.

Development: `npm test`; after manifest changes, run `herdr plugin link .` again.

[Changelog](CHANGELOG.md) · [Issues](https://github.com/huluhuluu/herdr-remark/issues) · [MIT License](LICENSE)
