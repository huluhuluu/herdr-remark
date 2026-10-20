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
    // [terminal, state sequence, status, completed round, scroll baseline, pending work]
    const value = JSON.parse(pane.tokens?.remark_activity || "null");
    return Array.isArray(value) && value[0] === pane.terminal_id ? value : null;
  } catch { return null; }
}

function pendingWork(previous) {
  return !!previous && (previous[5] === true || ["working", "blocked"].includes(previous[2]));
}

function completion(pane) {
  if (!["idle", "done"].includes(pane.agent_status)) return undefined;
  if (pane.completion_seq != null) return String(pane.completion_seq);
  if (pane.state_change_seq === undefined) return undefined;
  const seq = String(pane.state_change_seq);
  const previous = activity(pane);
  // On older Herdr, done is idle + native unseen, not a separate lifecycle
  // generation. Refreshes and detection recovery must retain the last round.
  if (!previous) return pane.agent_status === "done" ? seq : undefined;
  if (previous[1] === seq) return previous[3] || undefined;
  if (pendingWork(previous)) return seq;
  // Native done with an advanced lifecycle sequence can also reveal a turn
  // missed between polls. Reacquiring an unknown agent is not such evidence.
  if (pane.agent_status === "done" && ["idle", "done"].includes(previous[2])) return seq;
  return previous[3] || undefined;
}

function activityTokens(pane) {
  if (!pane.terminal_id || pane.state_change_seq === undefined) return null;
  const previous = activity(pane);
  // Keep the last completion through working/unknown snapshots. A subsequent
  // observed work -> idle/done transition replaces it with a new generation.
  const turn = completion(pane) ?? previous?.[3] ?? null;
  const scroll = turn === previous?.[3] ? previous[4] ?? null : pane.scroll ?? null;
  const pending = ["working", "blocked"].includes(pane.agent_status) ||
    (pane.agent_status === "unknown" && pendingWork(previous));
  const value = JSON.stringify([pane.terminal_id, String(pane.state_change_seq),
    pane.agent_status, turn, turn ? scroll : null, pending]);
  return value === pane.tokens?.remark_activity ? null : { remark_activity: value };
}

function stateOf(pane) {
  const status = pane.agent_status;
  if (status === "idle" || status === "done") {
    const turn = completion(pane);
    return pane.tokens?.remark_unread || (turn !== undefined && pane.tokens?.remark_seen !== turn) ||
      (status === "done" && turn === undefined && !activity(pane)) ? "unread" : "idle";
  }
  return Object.hasOwn(LAMPS, status) ? status : "unknown";
}

function isUnread(pane) {
  return !!pane.tokens?.remark_unread || stateOf(pane) === "unread";
}

function scrollBaseline(pane) {
  if (pane.tokens?.remark_unread) {
    try { return JSON.parse(pane.tokens.remark_scroll || "null") ?? undefined; }
    catch { return undefined; }
  }
  const previous = activity(pane);
  return previous?.[3] === completion(pane) ? previous?.[4] ?? undefined : undefined;
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
  const seen = pane.tokens?.remark_seen ?? null;
  return { remark_unread: unread ? String(seq) : null,
    // Keep the mark's scroll position so a scroll during monitor startup is
    // observed too. This small token follows the unread mark's lifecycle.
    remark_scroll: unread && pane.scroll ? JSON.stringify(pane.scroll) : null,
    // A view during work or detection recovery has no completion to acknowledge.
    // Keep the earlier read; the next completion still has a different generation.
    remark_seen: unread ? seen : completion(pane) ?? seen };
}

module.exports = { LAMP_TOKENS, DATA_TOKENS, READ_TOKENS,
  DATA_SOURCE, LAMP_SOURCE, READ_SOURCE, ACTIVITY_SOURCE,
  completion, activityTokens, stateOf, isUnread, lampTokens, readTokens, scrollBaseline };
