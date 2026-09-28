"use strict";

// pane.focused -> the pane has been read.
//
// Whether that clears the unread flag is a policy decision, because clicking a
// sidebar row focuses the pane: under the old unconditional behaviour, reaching
// for a marked agent destroyed the mark before you could act on it. See
// core.shouldClearOnFocus. A remark always stays pinned either way.
//
// This fires on every focus change, so it reads the state file first and only
// spends a CLI call when there is actually something to clear.

const state = require("./state");
const core = require("./core");
const ev = require("./event");

ev.guard(() => {
  const cfg = state.loadConfig();
  if (cfg.auto_clear_on_focus === "never") return;

  const { data } = ev.readEvent();
  const paneId = ev.eventPaneId(data);
  if (!paneId) return;

  const entry = state.getPane(state.readState(), paneId);
  if (!core.shouldClearOnFocus(entry, cfg)) return;

  core.markRead(paneId);
});
