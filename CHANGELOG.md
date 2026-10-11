# Changelog

## 0.6.1

- Keep observed active-tab completions unread even when Herdr reports `idle`. Use `completion_seq` when available; otherwise remember observed working/blocked transitions in one plugin token.
- Acknowledge a completion without calling `agent focus`, switching modes or acknowledging other agents in the Tab.
- Give manual unread marks distinct generations so a queued scroll acknowledgement cannot clear a newer mark in the same task.
- Ignore acknowledgements from focus hooks whose pane is no longer focused and rename hooks whose label no longer matches the Tab.
- Document the remaining event-order, automatic-rename and fullscreen-scrolling limitations. No Herdr patches, new dependencies or Agent wrappers.

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
