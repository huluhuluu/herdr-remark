# Changelog

## Unreleased

- Establish a read baseline for the first idle/completed Agent snapshot, including historical completions restored on startup and initial unknown detection recovery. Clear inherited read/unread marks when the terminal changes; preserve existing unread rounds on plugin reload and protect concurrent completions/manual marks during initialization.
- Capture the read generation before saving a note, so a completion arriving during the rename stays unread. Refuse to save an old editor's note after its Agent has exited.
- Advance the activity ordering clock on unchanged refreshes too. Delayed working records can no longer overwrite a current idle record and invent an unread completion after detection recovery.
- Reload the restored config after a failed or partial installation reload. If that runtime rollback also fails, distinguish the restored file from settings that may still be active and print the recovery command.
- Isolate monitor locks, wake requests, reloads and error logs by the actual API socket. Multiple Herdr sessions sharing plugin storage now animate and acknowledge reads independently; initialization also signals older shared monitors to reload.
- Retry transient Windows file-sharing failures during lock reads, publication and cleanup within a bounded window, preserving registration ordering. Surface worker errors directly in concurrency tests instead of waiting for a reply from an exited worker.
- Recheck focus, lifecycle generation and manual unread identity before acknowledging a read. Delayed actions cannot acknowledge a newer target snapshot, and toggle output reflects accepted state.
- Store scroll baselines compactly within the existing activity record, while accepting older object records. Retain Herdr's native metadata limits without additional chunking.
- Reject invalid UTF-8 configs before linking or writing. Compare original and installed config bytes before replacement or rollback so concurrent edits are preserved.
- Preserve management-marker text inside multiline TOML shell commands, and decode escaped shortcut values when checking conflicts. Ambiguous multiline shortcut declarations require a manual merge before any file is replaced.
- Bound complete socket requests and subscription startup even when partial bytes keep arriving. Continue polling after a transient failure while the same server still responds to ping.
- Read plugin identity and minimum versions from the manifests, detect shortcut conflicts from the actual example bindings, and share Herdr's text limit between metadata and the editor. Bound the complete lamp text as well. Comments mentioning a plugin action no longer cause a false conflict.
- Verify Linux installation and core interactions in isolated Ubuntu 22.04 / Herdr 0.9.5 sessions over SSH, including TUI shortcuts, popup editing, scroll subscriptions, monitor shutdown and two concurrent servers sharing plugin storage. Document the tested scope in both READMEs.
- Verify scrollback acknowledgement through both SSH followed by remote Herdr and a local `herdr --remote` client. Document application-owned mouse scrolling separately from Herdr's full-window terminal UI, including the lack of cross-machine native wheel forwarding.

## 0.6.5

- Retain pending work through unknown detection snapshots, without repeating an already acknowledged completion. Cover batch refreshes containing both an active agent and unrelated read agents.
- Hand off wake requests received during monitor shutdown after releasing ownership. Elect one monitor using unique process registrations, including stale-lock contention and interrupted startup; normal ticks keep the existing socket polling cadence.
- Preserve completed-round identity and read history across refreshes, native idle/done presentation changes, and temporary unknown detection states. Viewing during work or detection recovery no longer discards earlier read history.
- Capture automatic-completion scroll baselines in the existing activity record, so scrolling before the monitor subscribes is reconciled. Restart failed native wheel helpers with a five-second minimum between starts.
- Fix charset escape removal, remove unused exports/aliases and obsolete reap configuration comments, and share the unread predicate across refresh and monitoring.

## 0.6.4

- Add a Windows WezTerm adapter using the running GUI's read-only CLI, with PID/focus/content checks and bounds derived from actual pane sizes. Account for relative GUI socket discovery in the Windows runtime directory.
- Share native input capture, final foreground checks and generation-aware acknowledgement across hosts. Reuse UIA TextPattern for Console Host/OpenConsole instead of requiring Windows Terminal's control class.
- Add split/zoom, Unicode, padding, ambiguity, CLI failure and focus-change regression tests. Verify real WezTerm 20240203 CLI/GUI data and hidden-window rejection; physical wheel confirmation remains pending for the new hosts.
- Document host versus shell support, Windows/WSL/remote boundaries, validation levels and WezTerm edge/multiple-instance limitations in both READMEs. No new dependencies, terminal config changes or Agent installations.

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
