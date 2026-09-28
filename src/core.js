"use strict";

// Core mark/clear/render logic shared by actions, event hooks, and startup.
//
// Two tokens are reported per pane:
//   unread  - "1" while unread, cleared otherwise. Logic only: agent.view.set
//             filters and sorts on it. Not meant for a sidebar row.
//   inform  - the visible string: unread marker plus remark. Render it in a
//             sidebar row as $inform.

const herdr = require("./herdr");
const state = require("./state");

const UNREAD_TOKEN = "unread";
const DISPLAY_TOKEN = "inform";

/** Terminal columns a string occupies, counting CJK/emoji as 2. */
function displayWidth(str) {
  let w = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) continue;
    w += isWide(cp) ? 2 : 1;
  }
  return w;
}

function isWide(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

function truncateToWidth(str, max) {
  if (displayWidth(str) <= max) return str;
  let out = "";
  let w = 0;
  for (const ch of str) {
    const cw = isWide(ch.codePointAt(0)) ? 2 : 1;
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return out + "…";
}

/** Collapse whitespace; token values must stay single-line. */
function sanitizeNote(note) {
  if (!note) return "";
  return String(note).replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function renderDisplay(entry, cfg) {
  if (!entry) return "";
  const marker = entry.unread ? cfg.unread_marker : cfg.read_marker;
  const note = sanitizeNote(entry.note);
  const parts = [];
  if (marker) parts.push(marker);
  if (note) parts.push(note);
  // A flagged pane with no remark would otherwise render as a lone dot, which is
  // indistinguishable from the state_icon dot on the row above it.
  else if (entry.unread && cfg.unread_text) parts.push(cfg.unread_text);
  if (!parts.length) return "";
  return truncateToWidth(parts.join(" "), cfg.max_remark_width);
}

/**
 * Resolve config.notify_sound to a concrete Herdr sound name.
 * "auto" gives the finish chime for `done` and the attention chime otherwise.
 */
function resolveSound(cfg, status) {
  if (cfg.notify_sound !== "auto") return cfg.notify_sound;
  return status === "done" ? "done" : "request";
}

// Reasons that mean "you asked for this", as opposed to a status change the
// plugin noticed on its own.
const MANUAL_REASONS = new Set(["manual", "remark", "selection"]);

/**
 * Should focusing a pane drop its unread flag?
 *
 * Under the default "auto" policy, only self-flagged entries with no remark are
 * cleared. Anything you marked or annotated yourself has to be cleared
 * explicitly, otherwise glancing at the pane — or clicking its sidebar row,
 * which focuses it — would silently destroy the reminder you just set.
 */
function shouldClearOnFocus(entry, cfg) {
  if (!entry || !entry.unread) return false;
  const policy = cfg.auto_clear_on_focus;
  if (policy === "never") return false;
  if (policy === "always") return true;
  if (entry.note) return false;
  return !MANUAL_REASONS.has(entry.reason || "manual");
}

/** Push an entry's tokens to Herdr, or clear them when the entry is gone. */
function syncTokens(paneId, entry, cfg) {
  const display = renderDisplay(entry, cfg);
  herdr.reportTokens(paneId, {
    [UNREAD_TOKEN]: entry && entry.unread ? "1" : null,
    [DISPLAY_TOKEN]: display || null,
  });
}

/**
 * Mark a pane unread, optionally attaching or replacing its remark.
 * `note === undefined` keeps any existing remark.
 */
function mark(paneId, { note, reason = "manual", status = null } = {}) {
  const cfg = state.loadConfig();
  const entry = state.updateState((s) => {
    const prev = state.getPane(s, paneId) || {};
    const next = {
      unread: true,
      note: note === undefined ? prev.note || "" : sanitizeNote(note),
      marked_at: Date.now(),
      reason,
      status: status || prev.status || null,
    };
    return state.setPane(s, paneId, next);
  });
  syncTokens(paneId, entry, cfg);
  return entry;
}

/** Replace only the remark, leaving the unread flag alone. */
function setNote(paneId, note) {
  const cfg = state.loadConfig();
  const entry = state.updateState((s) => {
    const prev = state.getPane(s, paneId) || {};
    const clean = sanitizeNote(note);
    const next = {
      unread: prev.unread === undefined ? true : prev.unread,
      note: clean,
      marked_at: prev.marked_at || Date.now(),
      noted_at: Date.now(),
      reason: prev.reason || "manual",
      status: prev.status || null,
    };
    return state.setPane(s, paneId, next);
  });
  syncTokens(paneId, entry, cfg);
  return entry;
}

/** Drop the unread flag and remark for one pane. */
function clear(paneId) {
  const cfg = state.loadConfig();
  state.updateState((s) => state.setPane(s, paneId, null));
  syncTokens(paneId, null, cfg);
  return null;
}

/** Drop the unread flag but keep the remark pinned. */
function markRead(paneId) {
  const cfg = state.loadConfig();
  const entry = state.updateState((s) => {
    const prev = state.getPane(s, paneId);
    if (!prev) return null;
    if (!prev.note) return state.setPane(s, paneId, null);
    return state.setPane(s, paneId, { ...prev, unread: false });
  });
  syncTokens(paneId, entry, cfg);
  return entry;
}

function toggle(paneId, opts = {}) {
  const current = state.getPane(state.readState(), paneId);
  if (current && current.unread) return { entry: markRead(paneId), marked: false };
  return { entry: mark(paneId, opts), marked: true };
}

function clearAll() {
  const cfg = state.loadConfig();
  const paneIds = Object.keys(state.readState().panes);
  state.updateState((s) => {
    s.panes = {};
  });
  for (const paneId of paneIds) syncTokens(paneId, null, cfg);
  return paneIds.length;
}

/** Re-push every stored entry's tokens. Used by the startup hook. */
function resync() {
  const cfg = state.loadConfig();
  const panes = herdr.listPanes();
  const live = new Set(panes.map((p) => p.pane_id));
  const stale = [];
  const entries = Object.entries(state.readState().panes);
  for (const [paneId, entry] of entries) {
    // An empty pane list means "Herdr has not restored panes yet", not "every
    // pane is gone" — re-push nothing and drop nothing rather than lose state.
    if (!live.has(paneId)) {
      if (panes.length) stale.push(paneId);
      continue;
    }
    syncTokens(paneId, entry, cfg);
  }
  if (stale.length) {
    state.updateState((s) => {
      for (const paneId of stale) delete s.panes[paneId];
    });
  }
  return { restored: entries.length - stale.length, dropped: stale.length };
}

/** Shape one display row out of a stored entry plus whatever Herdr knows live. */
function buildRow(paneId, entry, agent, pane, alive) {
  return {
    pane_id: paneId,
    unread: !!(entry && entry.unread),
    note: (entry && entry.note) || "",
    marked_at: (entry && entry.marked_at) || 0,
    reason: (entry && entry.reason) || "",
    tracked: !!entry,
    agent: (agent && agent.agent) || (pane && pane.agent) || "-",
    status: (agent && agent.agent_status) || (pane && pane.agent_status) || "unknown",
    title: (agent && agent.terminal_title_stripped) || (pane && pane.title) || "",
    workspace_id: (agent && agent.workspace_id) || (pane && pane.workspace_id) || "",
    cwd: (agent && agent.cwd) || "",
    focused: !!((agent && agent.focused) || (pane && pane.focused)),
    alive,
  };
}

/** Join stored entries with live agent facts for display. Newest first. */
function inbox() {
  const s = state.readState();
  const agents = new Map(herdr.listAgents().map((a) => [a.pane_id, a]));
  const panes = new Map(herdr.listPanes().map((p) => [p.pane_id, p]));
  return state
    .unreadEntries(s)
    .map(([paneId, entry]) =>
      buildRow(paneId, entry, agents.get(paneId), panes.get(paneId), panes.has(paneId)),
    );
}

/**
 * Every live agent, flagged or not, unread first.
 *
 * Herdr exposes no way for a plugin to act on the agent highlighted in its
 * sidebar — the plugin context carries the focused pane only — so this list is
 * how you reach an agent you are not looking at.
 */
function allAgents() {
  const s = state.readState();
  const panes = new Map(herdr.listPanes().map((p) => [p.pane_id, p]));
  const rows = herdr
    .listAgents()
    .map((agent) =>
      buildRow(
        agent.pane_id,
        state.getPane(s, agent.pane_id),
        agent,
        panes.get(agent.pane_id),
        panes.has(agent.pane_id),
      ),
    );

  // A flagged pane whose agent has gone away still deserves a row.
  const seen = new Set(rows.map((r) => r.pane_id));
  for (const [paneId, entry] of state.unreadEntries(s)) {
    if (seen.has(paneId)) continue;
    rows.push(buildRow(paneId, entry, null, panes.get(paneId), panes.has(paneId)));
  }

  return rows.sort(
    (x, y) =>
      Number(y.unread) - Number(x.unread) ||
      (y.marked_at || 0) - (x.marked_at || 0) ||
      x.pane_id.localeCompare(y.pane_id),
  );
}

module.exports = {
  UNREAD_TOKEN,
  DISPLAY_TOKEN,
  displayWidth,
  truncateToWidth,
  sanitizeNote,
  renderDisplay,
  resolveSound,
  shouldClearOnFocus,
  syncTokens,
  mark,
  setNote,
  clear,
  markRead,
  toggle,
  clearAll,
  resync,
  inbox,
  allAgents,
};
