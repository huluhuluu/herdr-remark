"use strict";

const herdr = require("./herdr");
const STATUS_TEXT = { idle: "read", working: "working", blocked: "blocked",
  done: "unread", unknown: "unknown" };

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
  return manualUnread(pane) || pane.agent_status === "done";
}

function manualUnread(pane) {
  return !!pane.tokens?.remark_unread || pane.state_labels?.idle === "unread";
}

function setUnread(pane, unread) {
  const tab = herdr.cli(["tab", "list", "--workspace", pane.workspace_id]).tabs
    ?.find(tab => tab.tab_id === pane.tab_id);
  const context = [clean(tab?.label), clean(herdr.branch(pane.cwd))].filter(Boolean);
  const labels = Object.fromEntries(Object.entries(STATUS_TEXT).map(([state, text]) =>
    [state, [text, ...context].join("|")]));
  const marker = unread ? "● unread" : "";
  if ((pane.tokens?.remark_unread || "") === marker &&
    Object.entries(labels).every(([k, v]) => pane.state_labels?.[k] === v)) return;
  // Herdr selects and colors state_text alongside its native lamp. One text
  // field avoids the fixed wide separators between separate sidebar tokens.
  herdr.cli(["pane", "report-metadata", pane.pane_id, "--source", "plugin:" + herdr.ID,
    ...Object.entries(labels).flatMap(([k, v]) => ["--state-label", k + "=" + v]),
    ...(marker ? ["--token", "remark_unread=" + marker] : ["--clear-token", "remark_unread"])]);
}

function toggle(pane) {
  const unread = !isUnread(pane);
  if (!unread && pane.agent_status === "done") {
    herdr.cli(["agent", "focus", pane.pane_id]);
    pane = herdr.cli(["pane", "get", pane.pane_id]).pane;
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
  for (const pane of herdr.cli(["agent", "list"]).agents || []) setUnread(pane, manualUnread(pane));
}

function event() {
  const envelope = JSON.parse(process.env.HERDR_PLUGIN_EVENT_JSON || "{}");
  const data = envelope.data || envelope;
  const name = process.env.HERDR_PLUGIN_EVENT || envelope.event;
  if (name === "tab.renamed" || name === "tab.moved") {
    const tabId = data.tab_id || data.tab?.tab_id;
    for (const pane of herdr.cli(["agent", "list"]).agents || []) {
      if (pane.tab_id === tabId) setUnread(pane, manualUnread(pane));
    }
    return;
  }
  const id = data.pane_id || data.pane?.pane_id;
  if (!id) return;
  const pane = herdr.cli(["pane", "get", id]).pane;
  if (!pane?.agent) return;
  setUnread(pane, name === "pane.focused" ? false : manualUnread(pane));
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
