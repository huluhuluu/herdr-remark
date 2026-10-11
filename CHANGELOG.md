# Changelog

## 0.6.3

- Confirm Windows Terminal scroll-to-read works in the existing Herdr 0.9.1 environment. No additional Agents were installed.
- Extend Agent-independent API regression coverage to Codex, Claude Code, DST/`dsh-tui`, OpenCode, Copilot and custom Agent names, with and without native `completion_seq`.
- Make the shell installer POSIX-compatible and independent of `CDPATH`; test paths containing spaces, argument forwarding and exit-code propagation. Add macOS config-path checks.
- Extend the existing Windows/macOS/Linux CI matrix to Node.js 24 while retaining 18/20/22.
- Reorganize both READMEs around installation, Agent/host compatibility, usage, configuration, updating and troubleshooting. Explicitly distinguish cross-platform core behavior from Windows Terminal fullscreen wheel support.

## 0.6.2

- Add an experimental passive Windows Terminal wheel listener to the existing unread monitor. Match actual focused-pane content and geometry using public Herdr APIs and Windows UI Automation; keep public scrollback detection on other hosts/platforms.
- Start the helper only while unread panes exist, coalesce input, validate the observed round before acknowledging, and remove the hook on exit. No Agent wrappers, Herdr patches, dependencies, saved screen text or new environments.
- Add `wheel_read: false` to disable native listening independently of terminal scrollback and animation. Reuse the same helper in the bounded read-only probe.
- Validate 96 tests on Windows, including native helper startup/UTF-8/EOF cleanup; verify content-area coordinates match and sidebar coordinates do not. Physical wheel-to-green validation and native macOS fullscreen listening remain outstanding.

## 0.6.1

- Keep observed active-tab completions unread even when Herdr reports `idle`. Use `completion_seq` when available; otherwise remember observed working/blocked transitions in one plugin token.
- Acknowledge a completion without calling `agent focus`, switching modes or acknowledging other agents in the Tab.
- Give manual unread marks distinct generations so a queued scroll acknowledgement cannot clear a newer mark in the same task.
- Ignore acknowledgements from focus hooks whose pane is no longer focused and rename hooks whose label no longer matches the Tab.
- Document the remaining event-order, automatic-rename and fullscreen-scrolling limitations. No Herdr patches, new dependencies or Agent wrappers.
- Add an opt-in, bounded Windows Terminal wheel probe for read-only input/geometry experiments. It never changes read state and is not part of plugin startup.

## 0.6.0

- Saving a note acknowledges its agent; renaming a Tab acknowledges all agents in that Tab without changing their lifecycle status.
- Reconcile scrolling during subscription setup and document the distinction between terminal scrollback and fullscreen application scrolling.
- Keep two shortcuts for read/unread and popup note editing.
- Refresh directory, Tab name and Git branch from current pane state; Tab renames refresh all affected agents.
- Share one monitor between working-light animation and scroll-to-read; disabling animation keeps a steady working light.
- Track completion reads by turn, and order lamp, text and unread writes independently to prevent stale updates.
- Retry scroll subscriptions without stopping animation; report initialization failures after refreshing the remaining panes.
- Reload the monitor through Herdr's plugin environment using `npm run init`.
- Remove obsolete version migrations and standalone authority-cleanup tooling. Normal refreshes only write Remark metadata.
- Retain the existing installation scripts and regression tests; no dependencies or build step.

Earlier changes remain in [Git history](https://github.com/huluhuluu/herdr-remark/commits/main/).
