"use strict";

// Action dispatcher. Every [[actions]] entry in the manifest routes here.
//
// Actions are short-lived: they mutate state, push tokens, and exit. Anything
// interactive (typing a remark, browsing the inbox) is delegated to an
// overlay pane entrypoint, because an action command has no terminal of its own.

const herdr = require("./herdr");
const state = require("./state");
const core = require("./core");

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function fail(msg, code = 1) {
  process.stderr.write(`agent-inform: ${msg}\n`);
  process.exit(code);
}

function requirePane() {
  const paneId = herdr.resolveTargetPane();
  if (!paneId) fail("no target pane: focus an agent pane and try again");
  return paneId;
}

function paneLabel(paneId) {
  const agent = herdr.listAgents().find((a) => a.pane_id === paneId);
  if (!agent) return paneId;
  const title = agent.terminal_title_stripped || "";
  return title ? `${agent.agent || "agent"} · ${title}` : `${agent.agent || "agent"} · ${paneId}`;
}

async function ensureView() {
  const cfg = state.loadConfig();
  if (!cfg.sort_unread_first) return;
  try {
    await herdr.applyUnreadView();
  } catch (e) {
    // Sorting is a nicety; tokens and state are already correct without it.
    process.stderr.write(`agent-inform: view not applied (${e.message})\n`);
  }
}

async function cmdToggleUnread() {
  const paneId = requirePane();
  const cfg = state.loadConfig();
  const { entry, marked } = core.toggle(paneId);
  await ensureView();
  // Both directions notify. A keybinding has no other feedback, and a silent
  // unmark is indistinguishable from a binding that never fired.
  if (cfg.notify_on_manual_mark) {
    const detail = entry && entry.note ? `${paneLabel(paneId)}\n${entry.note}` : paneLabel(paneId);
    herdr.notify(marked ? "已标为未读" : "已标为已读", detail, {
      sound: core.resolveSound(cfg, null),
    });
  }
  log(
    marked
      ? `marked unread: ${paneId}${entry && entry.note ? ` (${entry.note})` : ""}`
      : `marked read: ${paneId}`,
  );
}

function cmdNote() {
  const paneId = requirePane();
  const existing = state.getPane(state.readState(), paneId);
  const res = herdr.openPane(
    "note-editor",
    {
      INFORM_TARGET_PANE: paneId,
      INFORM_EXISTING_NOTE: (existing && existing.note) || "",
      INFORM_PANE_LABEL: paneLabel(paneId),
    },
    ["--focus"],
  );
  if (!res) fail("could not open the remark editor overlay");
  log(`remark editor opened for ${paneId}`);
}

async function cmdNoteFromSelection() {
  const paneId = requirePane();
  const ctx = herdr.pluginContext();
  const selected = core.sanitizeNote(ctx.selected_text || "");
  if (!selected) {
    fail("no selected text in this invocation; use the remark editor instead");
  }
  const cfg = state.loadConfig();
  core.mark(paneId, { note: selected, reason: "selection" });
  await ensureView();
  if (cfg.notify_on_manual_mark) {
    herdr.notify("标记未读", `${paneLabel(paneId)}\n${selected}`, {
      sound: core.resolveSound(cfg, null),
    });
  }
  log(`marked unread with selection remark: ${paneId}`);
}

async function cmdClear() {
  const paneId = requirePane();
  core.clear(paneId);
  await ensureView();
  log(`cleared: ${paneId}`);
}

function cmdInbox() {
  const res = herdr.openPane("inbox-view", {}, ["--focus"]);
  if (!res) fail("could not open the inbox overlay");
  log("inbox opened");
}

/**
 * The inbox opened on every running agent rather than only the flagged ones.
 *
 * This is the way to flag an agent you are not currently focused on: Herdr gives
 * plugins the focused pane, never the agent highlighted in its sidebar, so
 * "select that row and mark it" has to happen in a pane the plugin owns.
 */
function cmdAgents() {
  const res = herdr.openPane("inbox-view", { INFORM_SHOW_ALL: "1" }, ["--focus"]);
  if (!res) fail("could not open the agent picker overlay");
  log("agent picker opened");
}

async function cmdClearAll() {
  const n = core.clearAll();
  await ensureView();
  log(`cleared ${n} pane(s)`);
}

function cmdStatus() {
  const entries = core.inbox();
  const cfg = state.loadConfig();
  log(`state file : ${state.STATE_FILE}`);
  log(`config file: ${state.CONFIG_FILE}`);
  log(`socket     : ${herdr.socketTarget()}`);
  log(`unread     : ${entries.filter((e) => e.unread).length}`);
  log(`with remark: ${entries.filter((e) => e.note).length}`);
  log(`auto mark  : ${cfg.auto_mark_on.join(", ") || "(off)"}`);
  log("");
  for (const e of entries) {
    log(
      `${e.unread ? "●" : " "} ${e.pane_id.padEnd(8)} ${e.status.padEnd(8)} ${
        e.note || "(no remark)"
      }`,
    );
  }
}

const COMMANDS = {
  "toggle-unread": cmdToggleUnread,
  note: cmdNote,
  "note-from-selection": cmdNoteFromSelection,
  clear: cmdClear,
  inbox: cmdInbox,
  agents: cmdAgents,
  "clear-all": cmdClearAll,
  status: cmdStatus,
};

async function main() {
  const cmd = process.argv[2];
  const fn = COMMANDS[cmd];
  if (!fn) {
    fail(
      `unknown command ${JSON.stringify(cmd)}; expected one of ${Object.keys(
        COMMANDS,
      ).join(", ")}`,
    );
  }
  state.writeDefaultConfigIfMissing();
  await fn();
}

main().catch((e) => fail(e.message));
