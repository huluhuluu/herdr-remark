# herdr-remark

**English** | [简体中文](README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Herdr 0.8.2+](https://img.shields.io/badge/Herdr-0.8.2%2B-89b4fa)](https://github.com/herdrdev/herdr)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-43853d)](https://nodejs.org/)

Two shortcuts to mark Herdr agents as read or unread and add short notes.

[Install](#install) · [Usage](#usage) · [Configuration](#configuration) · [Development](#development) · [Changelog](CHANGELOG.md)

## Features

- **One status light**: idle unread agents show a solid blue dot; working and blocked states take priority.
- **Two sidebar rows**: status light, directory and tab on the first row; Git branch and note on the second.
- **Popup notes**: edit without switching panes, with the existing note, agent summary or conversation title prefilled.
- **No build step**: no npm dependencies or background polling.

Layout example:

```text
● herdr-remark · Fix login
main · Waiting for API review
```

The light and directory share a color, separated by one space. The tab, branch and note are styled independently. Missing branches and notes are hidden.

## Install

Requires **Herdr 0.8.2+, Node.js 18+ and Git**. Supports Windows, macOS and Linux. Herdr 0.9.1 or later is recommended for its focus event fixes.

### Script installation (recommended)

Start Herdr, then run these commands in a terminal inside it. The required programs must be available on `PATH`.

**Windows · PowerShell**

```powershell
git clone https://github.com/huluhuluu/herdr-remark.git
cd herdr-remark
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

**Linux · Bash**

```bash
git clone https://github.com/huluhuluu/herdr-remark.git
cd herdr-remark
bash scripts/install.sh
```

The installer checks dependencies and validates the merged configuration, links this checkout, backs up the original config, writes the sidebar and shortcuts, then reloads and initializes the plugin. No `npm install` or administrator privileges are needed. Keep the checkout after installation: Herdr runs the linked plugin from this directory.

The config path follows `HERDR_CONFIG_PATH`, then `XDG_CONFIG_HOME/herdr/config.toml`, with these defaults:

| Platform | Config file |
| --- | --- |
| Windows | `%APPDATA%\herdr\config.toml` |
| Linux | `~/.config/herdr/config.toml` |

A custom path must match the running Herdr session. Backups are named `config.toml.remark-backup-<timestamp>` alongside the config; the installer prints the exact path.

Repeated runs update only the `# herdr-remark begin` / `end` block. If an Agent sidebar, per-agent layout or conflicting shortcut exists outside that block, the installer stops; use the manual configuration steps below. Validation failures leave the original file unchanged. Reload failures restore it, while keeping the plugin linked.

To validate the configuration without installing the plugin, append `--check`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 --check
```

```bash
bash scripts/install.sh --check
```

To update, run `git pull --ff-only` in the checkout and rerun the installer. It refreshes the managed block from the example, including resetting any colors or shortcuts customized inside it. Update manually to retain those customizations.

### Manual installation

```sh
herdr plugin install huluhuluu/herdr-remark
```

Merge [config.example.toml](config.example.toml) into Herdr's `config.toml`, then run:

```sh
herdr config check
herdr server reload-config
```

Replace the Agent sidebar `rows` with the example layout to avoid duplicate lights or status text. Update any `rows_by_agent` overrides as well. Change the example's `key` values if those shortcuts are already in use.

The plugin initializes when a session starts. When installing into an existing session, focus an agent or use a shortcut to refresh it. Run `npm run init` from the plugin directory to refresh all agents immediately.

## Usage

Focus the target agent, then use:

| Shortcut | Action |
| --- | --- |
| `prefix+u` | Toggle read / unread |
| `prefix+Shift+u` | Open the note popup |

Herdr's default `prefix` is `Ctrl+B`. To toggle unread, press `Ctrl+B`, release it, then press `U`. To edit a note, press `Ctrl+B`, then `Shift+U`.

### Status light

| Agent state | Light | Color |
| --- | --- | --- |
| Working | `●` | Yellow |
| Blocked / awaiting input | `●` | Red |
| Idle, read | `○` | Green |
| Idle, unread | `●` | Blue |
| Unknown | `·` | Gray |

A manual unread mark stays while you remain in the agent. Leaving and returning marks it as read; the shortcut can also clear it manually.

While working or blocked, the unread mark is retained but the light remains yellow or red. It turns blue once the agent is idle. Herdr's unseen background completion state (`done`) also shows blue.

### Notes

The popup prefills the existing pane name, then the agent's `$summary`, then the conversation title. If none is available, it starts empty.

| Action | Result |
| --- | --- |
| `Enter` | Save and close |
| Clear the text, then `Enter` | Remove the note |
| `Ctrl+C` | Cancel |

Notes are limited to 80 Unicode characters and saved as native Herdr pane names, so they follow pane moves and session restoration. Editing replaces an existing custom pane name. Saving or canceling does not explicitly change read status.

## Configuration

Sidebar layout, colors and shortcuts are configured in [config.example.toml](config.example.toml). After editing, run `herdr config check` and `herdr server reload-config`.

- Lights use static colors based on Catppuccin. Adjust `fg` to customize them; they do not automatically follow theme changes or animate.
- Directory and Git branch metadata refresh on events such as focus or agent state changes, without continuous polling.
- Unread marks last for the current Herdr server lifetime and reset on a cold restart. Notes persist through Herdr.
- Actions use shortcuts; native sidebar context menus are not provided.

The plugin ID remains `huluhlu.agent-inform` for compatibility with existing installs and shortcuts. Keep the sidebar configuration updated when upgrading; see the [changelog](CHANGELOG.md).

## Development

```sh
git clone https://github.com/huluhuluu/herdr-remark.git
cd herdr-remark
herdr plugin link .
npm test
```

No `npm install` is needed. After code changes, run `npm run init` in a Herdr session to refresh the sidebar. After manifest changes, rerun `herdr plugin link .`.

Report bugs or suggest features in [Issues](https://github.com/huluhuluu/herdr-remark/issues), including your Herdr version, operating system and reproduction steps. Pull requests are welcome.

## License

[MIT](LICENSE)
