"use strict";

const { ID } = require("./herdr");
const { directory } = require("./text");

// Each field family has one ordering clock. Animation cannot invalidate data
// refreshes or user actions, but every lamp writer orders against every other.
const DATA_SOURCE = "plugin:" + ID;
const LAMP_SOURCE = DATA_SOURCE + ":lamps";
const READ_SOURCE = DATA_SOURCE + ":read";
const ACTIVITY_SOURCE = DATA_SOURCE + ":activity";

// Refresh and animation share the complete token set. Finished, unviewed turns
// and manual unread marks both use the blue unread lamp.
const LAMPS = { working: "●", blocked: "●", idle: "○", unread: "●", unknown: "·" };
// The dim twin the blink daemon alternates with `remark_lamp_working`.
const BLINK_TOKEN = "remark_lamp_working_blink";
const LAMP_TOKENS = Object.keys(LAMPS).map(key => "remark_lamp_" + key)
  .concat(BLINK_TOKEN);
const DATA_TOKENS = ["remark_tab", "remark_branch", "remark_note"];
const READ_TOKENS = ["remark_unread", "remark_seen", "remark_scroll"];

function activity(pane) {
  try {
    const value = JSON.parse(pane.tokens?.remark_activity || "null");
    return Array.isArray(value) && value[0] === pane.terminal_id ? value : null;
  } catch { return null; }
}

function completion(pane) {
  if (!["idle", "done"].includes(pane.agent_status)) return undefined;
  if (pane.completion_seq != null) return String(pane.completion_seq);
  if (pane.state_change_seq === undefined) return undefined;
  const seq = String(pane.state_change_seq);
  if (pane.agent_status === "done") return seq;
  const previous = activity(pane);
  if (previous?.[1] === seq) return previous[3] || undefined;
  // Older Herdr versions expose active-tab completions as idle. Only infer a
  // completion after observing work in this same terminal, never from idle alone.
  if (previous && ["working", "blocked"].includes(previous[2])) return seq;
  return undefined;
}

function activityTokens(pane) {
  if (!pane.terminal_id || pane.state_change_seq === undefined) return null;
  const value = JSON.stringify([pane.terminal_id, String(pane.state_change_seq),
    pane.agent_status, completion(pane) || null]);
  return value === pane.tokens?.remark_activity ? null : { remark_activity: value };
}

function stateOf(pane, unread = !!pane.tokens?.remark_unread) {
  const status = pane.agent_status;
  if (status === "idle" || status === "done") {
    const turn = completion(pane);
    return unread || (turn !== undefined && pane.tokens?.remark_seen !== turn) ||
      (status === "done" && turn === undefined) ? "unread" : "idle";
  }
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

function readTokens(pane, unread, seq) {
  return { remark_unread: unread ? String(seq) : null,
    // Keep the mark's scroll position so a scroll during monitor startup is
    // observed too. This small token follows the unread mark's lifecycle.
    remark_scroll: unread && pane.scroll ? JSON.stringify(pane.scroll) : null,
    remark_seen: !unread ? completion(pane) ?? null : null };
}

module.exports = { LAMP_TOKENS, DATA_TOKENS, READ_TOKENS,
  DATA_SOURCE, LAMP_SOURCE, READ_SOURCE, ACTIVITY_SOURCE,
  completion, activityTokens, stateOf, lampTokens, readTokens };
