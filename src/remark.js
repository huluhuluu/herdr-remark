"use strict";

const herdr = require("./herdr");
const STATUSES = ["idle", "working", "blocked", "done", "unknown"];

function clean(text) {
  return Array.from(String(text || "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim())
    .slice(0, 80).join("");
}

function initialNote(pane) {
  return clean(pane.label || pane.tokens?.summary || pane.terminal_title_stripped ||
    pane.title || "");
}

function isUnread(pane) {
  return pane.state_labels?.idle === "unread" || pane.agent_status === "done";
}

function setUnread(pane, unread) {
  const labels = Object.fromEntries(STATUSES.map(status =>
    [status, unread || status === "done" ? "unread" : "read"]));
  if (STATUSES.every(s => pane.state_labels?.[s] === labels[s])) return;
  // state_text inherits the same live theme color as state_icon.
  // Change presentation only; never report an artificial agent lifecycle state.
  herdr.cli(["pane", "report-metadata", pane.pane_id, "--source", "plugin:" + herdr.ID,
    ...STATUSES.flatMap(s => ["--state-label", s + "=" + labels[s]])]);
}

function toggle(pane) {
  const unread = !isUnread(pane);
  if (!unread && pane.agent_status === "done") {
    herdr.cli(["agent", "focus", pane.pane_id]);
  }
  setUnread(pane, unread);
  return unread;
}

function saveNote(terminalId, note) {
  const pane = herdr.paneForTerminal(terminalId);
  const value = clean(note);
  // Native names persist and follow a terminal when its pane moves.
  // Herdr trims names; a leading space keeps a literal '--clear' from being an option.
  herdr.cli(["pane", "rename", pane.pane_id, value ? " " + value : "--clear"]);
}

function initialize() {
  for (const pane of herdr.cli(["agent", "list"]).agents || []) setUnread(pane, false);
}

function event() {
  const envelope = JSON.parse(process.env.HERDR_PLUGIN_EVENT_JSON || "{}");
  const data = envelope.data || envelope;
  const id = data.pane_id || data.pane?.pane_id;
  if (!id) return;
  const pane = herdr.cli(["pane", "get", id]).pane;
  if (!pane?.agent) return;
  const name = process.env.HERDR_PLUGIN_EVENT || envelope.event;
  setUnread(pane, name === "pane.focused" ? false : pane.state_labels?.idle === "unread");
}

function main(command = process.argv[2]) {
  if (command === "init") return initialize();
  if (command === "event") return event();
  const pane = herdr.target();
  if (command === "toggle-unread") {
    process.stdout.write((toggle(pane) ? "unread" : "read") + ": " + pane.pane_id + "\n");
  } else if (command === "note") {
    herdr.openEditor(pane, initialNote(pane));
  } else {
    throw new Error("Unknown action: " + command);
  }
}

if (require.main === module) {
  try { main(); } catch (e) {
    process.stderr.write("remark: " + e.message + "\n");
    process.exitCode = 1;
  }
}

module.exports = { clean, initialNote, isUnread, setUnread, toggle, saveNote, main };
