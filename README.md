# Remark for Herdr

[![Tests](https://github.com/huluhuluu/herdr-remark/actions/workflows/test.yml/badge.svg)](https://github.com/huluhuluu/herdr-remark/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**English** · [简体中文](README.zh-CN.md)

Keep track of finished Agent turns, mark them read, and add short notes without leaving Herdr. No npm dependencies, build step, Agent wrappers, or Herdr patches.

![Sidebar layout and note popup illustration](docs/images/preview.svg)

*Illustration, not a screenshot.* First row: status light + directory · Tab. Second row: Git branch · note. Empty fields stay hidden.

[Install](#install) · [Usage](#usage) · [Compatibility](#compatibility) · [Settings](#settings) · [Update](#update) · [Troubleshooting](#troubleshooting)

## Compatibility

Remark uses Herdr's pane identity and lifecycle API, with **no Agent-name whitelist**. Codex, Claude Code, DST (reported as `dsh-tui` in the tested environment), and other [Herdr-recognized or self-reporting Agents](https://herdr.dev/docs/agents/) use the same logic. The model/provider behind an Agent does not affect Remark. Herdr must recognize the pane as an Agent and report its state correctly; Remark does not add detection for an otherwise unsupported Agent.

| Host | Status, notes, shortcuts | Terminal scrollback → read | Fullscreen application wheel → read |
| --- | --- | --- | --- |
| Windows + Windows Terminal | Yes | Yes | Yes, through a passive native listener |
| Windows + other terminals | Yes | Yes | Not implemented |
| macOS | Yes | Yes | Not implemented |
| Linux | Yes | Yes | Not implemented |
| SSH / remote server | Through the target server's API | Yes, when reported by Herdr | Requires the listener and terminal desktop on the same machine |

Requirements: **Herdr 0.8.2+, Node.js 18+ and Git** available to Herdr's plugin processes. Herdr 0.9.1+ is recommended for native focus-event fixes. `completion_seq`, when supplied by newer Herdr versions, is used without requiring a version-specific adapter.

Windows Terminal scroll-to-read has been confirmed in a live Herdr 0.9.1 session. CI covers Windows, macOS and Linux with Node.js 18/20/22/24; Agent contract tests include Codex, Claude Code, DST/`dsh-tui`, OpenCode, Copilot and arbitrary custom names. These tests verify shared API behavior, **not live installations of every Agent or terminal**. Native macOS/Linux desktop behavior has not been manually verified.

## Install

Run inside your existing Herdr session:

```sh
git clone https://github.com/huluhuluu/herdr-remark.git
cd herdr-remark
```

**Windows · PowerShell**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

**macOS / Linux · POSIX shell**

```sh
sh scripts/install.sh
```

Or use `node scripts/install.js` on any supported platform. There is no `npm install` step. Add `--check` to any installer command to validate without linking or replacing the active config.

The installer validates the config, backs it up when changed, links the plugin, and adds sidebar rows and shortcuts. It preserves unrelated settings and stops if unmanaged sidebar/keybinding settings conflict. In that case, merge [config.example.toml](config.example.toml) into the active config, then run `herdr plugin link .` and `npm run init`. Existing `rows_by_agent` layouts may need the same tokens added manually.

**Keep this checkout after installation:** Herdr links to it. The default config is `%APPDATA%\herdr\config.toml` on Windows or `~/.config/herdr/config.toml` on macOS/Linux. `HERDR_CONFIG_PATH` overrides the file; `XDG_CONFIG_HOME` overrides the config base. `HERDR_BIN_PATH` can select a Herdr executable outside `PATH`.

## Usage

Focus the target Agent. The default `prefix` is `Ctrl+B`: press and release it, then press the next key.

| Shortcut | Action |
| --- | --- |
| `prefix+u` | Toggle read / unread |
| `prefix+shift+u` | Edit a short note in a popup |

| State | Light |
| --- | --- |
| Working | Yellow `●`, pulsing |
| Blocked / awaiting input | Red `●` |
| Idle, read | Green `○` |
| Unread completion or manual mark | Blue `●` |
| Unknown | Gray `·` |

Every observed completed turn starts **blue**, including in the current Tab. Staying there or receiving more output does not acknowledge it. A read action clears the current unread mark; the next completion becomes blue again. Working and blocked states take precedence over read state.

Read actions are: the toggle shortcut, leaving and returning to the pane, actual terminal scrollback movement, supported content-area wheel input, saving/clearing a note, or renaming the Tab. **Tab renaming acknowledges every Agent in that Tab**, including renames performed by another plugin. Directory, Tab name and Git branch are resolved again on each status refresh; animation ticks only change the lamp.

Notes use the current pane name, Agent summary, or conversation title as their initial value. `Enter` saves, empty input + `Enter` clears, and `Ctrl+C` cancels. A note replaces the native pane name and is limited to 80 Unicode characters. Renaming a pane outside this shortcut refreshes the displayed note on the next focus or Agent event.

## Settings

Find the plugin config directory:

```sh
herdr plugin config-dir huluhlu.agent-inform
```

Create `config.json` there; all settings are optional:

```json
{ "blink": true, "blink_interval_ms": 800, "wheel_read": true }
```

| Setting | Behavior |
| --- | --- |
| `blink` | Set false for a steady working light. Scroll-to-read remains available. |
| `blink_interval_ms` | Pulse interval, clamped to 100–60000 ms. Default: 800. |
| `wheel_read` | Enables the Windows Terminal listener. False retains public terminal scrollback detection. |

Changes apply on the monitor's next cycle. If it has exited, run `npm run init`. The native helper runs only while panes are unread; the shared monitor exits when neither unread panes nor animated working lights need it. Colors are static and can be changed in Herdr's sidebar config.

To change shortcuts, edit the existing `key` entries in the `# herdr-remark begin` / `end` block of Herdr's config; do not append duplicates. Validate with `herdr config check`, then apply with `herdr server reload-config`.

## Update

From this checkout:

```sh
git pull --ff-only
herdr plugin link .
npm run init
```

Initialization waits for Herdr's refresh action and reloads an existing monitor. It does not restart Agents. Rerunning the installer replaces the managed block with the example defaults, including its shortcuts and colors; use the commands above to preserve your customizations.

## Troubleshooting

- **An Agent is missing or has the wrong working/blocked state:** inspect `herdr agent explain <pane_id>` and [Herdr's detection documentation](https://herdr.dev/docs/agents/). Remark only writes its own metadata; it never reports lifecycle state or clears Agent authority.
- **Fullscreen scrolling stays blue:** the native listener currently supports Windows Terminal only. It checks the foreground window, actual focused pane, visible text and content-area coordinates. Locked/background windows, ambiguous matches or insufficient text remain unread. Use another read action when matching is unavailable. The listener does not consume/inject mouse input or inspect keystrokes; text is compared in memory through local pipes, never saved or logged.
- **The listener stopped:** run `npm run init`. For input-only diagnostics, run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/probe-scroll.ps1 -Seconds 30`. This bounded probe changes no read state and does not inspect conversation text.
- **Refresh failed:** inspect `herdr plugin log list --plugin huluhlu.agent-inform`; verify Node.js/Git/Herdr are available to the existing server's plugin environment. Retry `npm run init` after correcting the cause.

Known API limits: older Herdr versions can only infer active-Tab completions from observed working/blocked → idle transitions. Missed rounds cannot be recovered from an idle snapshot alone. Focus/rename hooks carry no original sequence or user/plugin origin, so a delayed event that still matches current state is not always distinguishable. Screen matching cannot reliably distinguish different sessions displaying identical content. Wheel input at a scroll boundary still counts as viewing. Read marks reset with the Herdr server; native pane notes persist through Herdr.

## Development

```sh
npm test
```

The existing Node test runner uses no extra packages or Agent installations. Windows tests exercise the native helper's startup, UTF-8 protocol and EOF cleanup; macOS/Linux tests exercise the POSIX installer with spaces and `CDPATH`. Temporary test files are removed after use. Report problems with the OS, terminal, Herdr/Node/Agent versions and steps to reproduce; redact conversation text and private paths.

[Changelog](CHANGELOG.md) · [Issues](https://github.com/huluhuluu/herdr-remark/issues) · [MIT License](LICENSE)
