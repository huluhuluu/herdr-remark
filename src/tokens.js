"use strict";

const { ID } = require("./herdr");
const { directory } = require("./text");

// Each field family has one ordering clock. Animation cannot invalidate data
// refreshes or user actions, but every lamp writer orders against every other.
const DATA_SOURCE = "plugin:" + ID;
const LAMP_SOURCE = DATA_SOURCE + ":lamps";
const READ_SOURCE = DATA_SOURCE + ":read";

// Refresh and animation share the complete token set. Finished, unviewed turns
// and manual unread marks both use the blue unread lamp.
const LAMPS = { working: "●", blocked: "●", idle: "○", unread: "●", unknown: "·" };
// The dim twin the blink daemon alternates with `remark_lamp_working`.
const BLINK_TOKEN = "remark_lamp_working_blink";
const LAMP_TOKENS = Object.keys(LAMPS).map(key => "remark_lamp_" + key)
  .concat(BLINK_TOKEN);
const DATA_TOKENS = ["remark_tab", "remark_branch", "remark_note"];
const READ_TOKENS = ["remark_unread", "remark_seen", "remark_scroll"];

function stateOf(pane, unread = !!pane.tokens?.remark_unread) {
  const status = pane.agent_status;
  if (status === "done") return !unread && pane.state_change_seq !== undefined &&
    pane.tokens?.remark_seen === String(pane.state_change_seq) ? "idle" : "unread";
  if (status === "idle") return unread ? "unread" : "idle";
  return Object.hasOwn(LAMPS, status) ? status : "unknown";
}

function lampTokens(pane, on = true) {
  const tokens = Object.fromEntries(LAMP_TOKENS.map(key => [key, null]));
  if (!pane.agent) return tokens;
  const state = stateOf(pane);
  const key = state === "working" && !on ? BLINK_TOKEN : "remark_lamp_" + state;
  tokens[key] = [LAMPS[state], directory(pane.cwd)].filter(Boolean).join(" ");
  return tokens;
}

function readTokens(pane, unread) {
  return { remark_unread: unread ? "1" : null,
    // Keep the mark's scroll position so a scroll during monitor startup is
    // observed too. This small token follows the unread mark's lifecycle.
    remark_scroll: unread && pane.scroll ? JSON.stringify(pane.scroll) : null,
    remark_seen: !unread && pane.agent_status === "done" && pane.state_change_seq !== undefined
      ? String(pane.state_change_seq) : null };
}

module.exports = { LAMP_TOKENS, DATA_TOKENS, READ_TOKENS,
  DATA_SOURCE, LAMP_SOURCE, READ_SOURCE, stateOf, lampTokens, readTokens };
