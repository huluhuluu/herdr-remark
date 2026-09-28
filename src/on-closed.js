"use strict";

// pane.closed -> forget the pane.
//
// Two reasons, not one. A closed pane's entry would sit in the state file
// forever and show up in the inbox as a dead row; and Herdr's internal pane
// numbering *is* recycled after a pane exits, so a stale entry risks attaching
// an old unread mark to an unrelated new pane. The startup hook prunes the same
// way, for entries whose close event was missed while the server was down.

const state = require("./state");
const ev = require("./event");

ev.guard(() => {
  const { data } = ev.readEvent();
  const paneId = ev.eventPaneId(data);
  if (!paneId) return;

  const entry = state.getPane(state.readState(), paneId);
  if (!entry) return;

  // No token cleanup: the pane is gone, so its metadata went with it.
  state.updateState((s) => {
    delete s.panes[paneId];
  });
});
