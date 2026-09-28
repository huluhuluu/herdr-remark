"use strict";

const herdr = require("./herdr");
const path = require("node:path");
const LAMPS = { working: "●", blocked: "●", idle: "○", unread: "○", unknown: "·" };

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

function directory(cwd = "") {
  const parser = cwd.includes("\\") || /^[A-Za-z]:/.test(cwd) ? path.win32 : path.posix;
  return clean(parser.basename(cwd) || parser.parse(cwd).root);
}

function update(pane, unread = !!pane.tokens?.remark_unread) {
  const tab = herdr.cli(["tab", "list", "--workspace", pane.workspace_id]).tabs
    ?.find(item => item.tab_id === pane.tab_id);
  const state = pane.agent_status === "done" || (pane.agent_status === "idle" && unread)
    ? "unread" : Object.hasOwn(LAMPS, pane.agent_status) ? pane.agent_status : "unknown";
  const tokens = {
    remark_unread: unread ? "1" : "",
    remark_directory: directory(pane.cwd),
    remark_tab: clean(tab?.label),
    remark_branch: clean(herdr.branch(pane.cwd)),
    remark_note: clean(pane.label),
  };
  for (const [key, icon] of Object.entries(LAMPS)) tokens["remark_lamp_" + key] = key === state ? icon : "";
  if (!Object.keys(pane.state_labels || {}).length &&
    Object.entries(tokens).every(([k, v]) => (pane.tokens?.[k] || "") === v)) return;
  // Exactly one lamp token is populated; 0.8.2 supports fixed token colors.
  herdr.cli(["pane", "report-metadata", pane.pane_id, "--source", "plugin:" + herdr.ID,
    "--clear-state-labels",
    ...Object.entries(tokens).flatMap(([k, v]) => v ? ["--token", k + "=" + v] : ["--clear-token", k])]);
}

function toggle(pane) {
  const unread = !(pane.tokens?.remark_unread || pane.agent_status === "done");
  if (!unread && pane.agent_status === "done") {
    herdr.cli(["agent", "focus", pane.pane_id]);
    pane = herdr.cli(["pane", "get", pane.pane_id]).pane;
  }
  update(pane, unread);
  return unread;
}

function saveNote(terminalId, note) {
  const pane = herdr.paneForTerminal(terminalId);
  const value = clean(note);
  // Native names persist and follow a terminal when its pane moves.
  // Herdr trims names; a leading space keeps a literal '--clear' from being an option.
  herdr.cli(["pane", "rename", pane.pane_id, value ? " " + value : "--clear"]);
  herdr.cli(["pane", "report-metadata", pane.pane_id, "--source", "plugin:" + herdr.ID,
    ...(value ? ["--token", "remark_note=" + value] : ["--clear-token", "remark_note"])]);
}

function event() {
  const envelope = JSON.parse(process.env.HERDR_PLUGIN_EVENT_JSON || "{}");
  const data = envelope.data || envelope;
  const name = process.env.HERDR_PLUGIN_EVENT || envelope.event;
  if (name === "tab.renamed") {
    const tabId = data.tab_id || data.tab?.tab_id;
    for (const pane of herdr.cli(["agent", "list"]).agents || [])
      if (pane.tab_id === tabId) update(pane);
    return;
  }
  const id = data.pane_id || data.pane?.pane_id;
  if (!id) return;
  const pane = herdr.cli(["pane", "get", id]).pane;
  if (!pane?.agent) return;
  update(pane, name === "pane.focused" ? false : undefined);
}

function main(command = process.argv[2]) {
  if (command === "init") {
    for (const pane of herdr.cli(["agent", "list"]).agents || []) update(pane);
    return;
  }
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

module.exports = { clean, initialNote, directory, update, toggle, saveNote, main };
