"use strict";

const { ID } = require("./herdr");
const { createHash } = require("node:crypto");
const { clean, directory } = require("./text");

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

// Herdr caps each metadata value at 80 characters. Field names in a scroll
// object exhaust that budget inside the round record; store just the numbers.
function compactScroll(scroll) {
  return scroll ? [scroll.offset_from_bottom, scroll.max_offset_from_bottom, scroll.viewport_rows] : null;
}

function expandScroll(scroll) {
  return Array.isArray(scroll) ? {
    offset_from_bottom: scroll[0], max_offset_from_bottom: scroll[1], viewport_rows: scroll[2],
  } : scroll;
}

function activity(pane) {
  try {
    // [terminal, state sequence, status, completed round, scroll baseline, phase]
    const value = JSON.parse(pane.tokens?.remark_activity || "null");
    if (!Array.isArray(value) || value[0] !== pane.terminal_id || sessionChanged(pane)) return null;
    value[4] = expandScroll(value[4]);
    return value;
  } catch { return null; }
}

function sessionKey(pane) {
  const session = pane.agent_session;
  if (!session?.value) return null;
  // Compare the native identity, not its reporting hook. Paths and ids can be
  // long; the token stores only an equality key, never conversation contents.
  return createHash("sha256").update(JSON.stringify([session.agent, session.kind, session.value])).digest("hex");
}

function sessionChanged(pane) {
  const current = sessionKey(pane);
  return !!current && !!pane.tokens?.remark_session && current !== pane.tokens.remark_session;
}

// 0: acquiring a conversation, 1: ready, 2: work observed after readiness.
// Keep this in the existing compact slot; startup and blocked-only recovery
// must not acquire the same completion authority as an actual working turn.
function phase(previous) {
  if (!previous) return 0;
  if (typeof previous[5] === "number") return previous[5];
  // Older records counted blocked as work. Migrate only an observed working
  // state as pending; preserve already recorded completions independently.
  if (previous[2] === "working") return 2;
  return previous[3] != null || ["idle", "done"].includes(previous[2]) ? 1 : 0;
}

function pendingWork(previous) {
  return phase(previous) === 2;
}

function completion(pane) {
  if (!["idle", "done"].includes(pane.agent_status)) return undefined;
  const previous = activity(pane);
  const recorded = previous ? pane.tokens?.remark_round ?? undefined : undefined;
  // A native completion can predate our first observation or follow blocked -> idle.
  // Admit a new round only after this conversation was ready and then worked.
  if (pane.completion_seq != null && pendingWork(previous)) return String(pane.completion_seq);
  return recorded;
}

function activityTokens(pane) {
  if (!pane.terminal_id || pane.state_change_seq === undefined) return null;
  const previous = activity(pane);
  // Keep the last native completion through working/unknown snapshots. Only a
  // newly reported native completion replaces its generation.
  const turn = completion(pane) ?? (previous ? pane.tokens?.remark_round : null) ?? null;
  const scroll = turn === previous?.[3] ? previous[4] ?? null : pane.scroll ?? null;
  const prior = phase(previous);
  const next = ["idle", "done"].includes(pane.agent_status) ? 1 :
    pane.agent_status === "blocked" ? (prior ? 1 : 0) :
    prior && pane.agent_status === "working" ? 2 : prior;
  const value = JSON.stringify([pane.terminal_id, String(pane.state_change_seq),
    pane.agent_status, turn, turn ? compactScroll(scroll) : null, next]);
  // Even an unchanged record must advance this source's ordering clock so a
  // delayed report cannot restore an older working state after this refresh.
  return { remark_activity: value, remark_round: turn,
    remark_session: sessionKey(pane) ?? pane.tokens?.remark_session ?? null };
}

function sameReadState(expected, live) {
  return !!expected && !!live && expected.pane_id === live.pane_id && expected.terminal_id === live.terminal_id &&
    sessionKey(expected) === sessionKey(live) &&
    expected.state_change_seq === live.state_change_seq && expected.completion_seq === live.completion_seq &&
    expected.tokens?.remark_unread === live.tokens?.remark_unread;
}

function stateOf(pane) {
  const status = pane.agent_status;
  if (status === "idle" || status === "done") {
    const turn = completion(pane);
    const inherited = sessionChanged(pane);
    return (!inherited && pane.tokens?.remark_unread) ||
      (turn !== undefined && (inherited || pane.tokens?.remark_seen !== turn)) ? "unread" : "idle";
  }
  return Object.hasOwn(LAMPS, status) ? status : "unknown";
}

function isUnread(pane) {
  return (!sessionChanged(pane) && !!pane.tokens?.remark_unread) || stateOf(pane) === "unread";
}

function scrollBaseline(pane) {
  if (sessionChanged(pane)) return undefined;
  if (pane.tokens?.remark_unread) {
    try { return expandScroll(JSON.parse(pane.tokens.remark_scroll || "null")) ?? undefined; }
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
  tokens[key] = clean([LAMPS[state], directory(pane.cwd)].filter(Boolean).join(" "));
  return tokens;
}

function readTokens(pane, unread, seq) {
  const seen = sessionChanged(pane) ? null : pane.tokens?.remark_seen ?? null;
  return { remark_unread: unread ? String(seq) : null,
    // Keep the mark's scroll position so a scroll during monitor startup is
    // observed too. This small token follows the unread mark's lifecycle.
    remark_scroll: unread && pane.scroll ? JSON.stringify(compactScroll(pane.scroll)) : null,
    // A view during work or detection recovery has no completion to acknowledge.
    // Keep the earlier read; the next completion still has a different generation.
    remark_seen: unread ? seen : completion(pane) ?? seen };
}

module.exports = { LAMP_TOKENS, DATA_TOKENS, READ_TOKENS,
  DATA_SOURCE, LAMP_SOURCE, READ_SOURCE, ACTIVITY_SOURCE,
  sessionKey, sessionChanged, activity, pendingWork, completion, activityTokens, sameReadState, stateOf, isUnread, lampTokens, readTokens, scrollBaseline };
