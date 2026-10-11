# Changelog

## 0.6.0

- Keep two shortcuts for read/unread and popup note editing.
- Refresh directory, Tab name and Git branch from current pane state; Tab renames refresh all affected agents.
- Share one monitor between working-light animation and scroll-to-read; disabling animation keeps a steady working light.
- Track completion reads by turn, and order lamp, text and unread writes independently to prevent stale updates.
- Retry scroll subscriptions without stopping animation; report initialization failures after refreshing the remaining panes.
- Reload the monitor through Herdr's plugin environment using `npm run init`.
- Remove obsolete version migrations and standalone authority-cleanup tooling. Normal refreshes only write Remark metadata.
- Retain the existing installation scripts and regression tests; no dependencies or build step.

Earlier changes remain in [Git history](https://github.com/huluhuluu/herdr-remark/commits/main/).
