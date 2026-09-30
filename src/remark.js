"use strict";

const herdr = require("./herdr");
const path = require("node:path");
const LAMPS = { working: "●", blocked: "●", idle: "○", unread: "●", unknown: "·" };

function clean(text) {
  return Array.from(String(text || "")
    // OSC (ESC ] ... BEL or ST) carries no visible text; strip it before the
    // generic control-character pass would turn its payload into visible junk.
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\|$)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    // Other two-character escapes (ESC ( ) * + # % and single-letter ones).
    .replace(/\x1b[@-Z\\\[\]_()*+#%\-]?/g, "")
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

function update(pane, unread, known = {}) {
  // Herdr hooks run in separate processes. A system monotonic timestamp orders
  // refreshes even when a rename does not increment the pane's revision. The
  // unread write shares it: an unsequenced report would let a stale focus event
  // clear a flag the user just set. Both reports need distinct sequences,
  // because Herdr ignores a report whose sequence equals the last accepted one.
  const seq = process.hrtime.bigint();
  // Only explicit user/focus actions write the unread flag. Background refreshes
  // must not restore a flag from an older snapshot while Git is running.
  if (unread !== undefined) herdr.cli(["pane", "report-metadata", pane.pane_id,
    "--source", "plugin:" + herdr.ID, "--seq", seq.toString(),
    ...(unread ? ["--token", "remark_unread=1"] : ["--clear-token", "remark_unread"])]);
  // Batched callers pass what they already fetched for the whole batch; `??`
  // keeps a legitimately empty label or branch from triggering a second lookup.
  const branch = clean(known.branch ?? herdr.branch(pane.cwd));
  const tabLabel = known.tabLabel ?? herdr.cli(["tab", "list", "--workspace", pane.workspace_id])
    .tabs?.find(item => item.tab_id === pane.tab_id)?.label;
  pane = herdr.cli(["pane", "get", pane.pane_id]).pane;
  unread = !!pane.tokens?.remark_unread;
  const state = pane.agent_status === "done" || (pane.agent_status === "idle" && unread)
    ? "unread" : Object.hasOwn(LAMPS, pane.agent_status) ? pane.agent_status : "unknown";
  const tokens = {
    remark_tab: clean(tabLabel),
    remark_branch: branch,
    remark_note: clean(pane.label),
  };
  const folder = directory(pane.cwd);
  for (const [key, icon] of Object.entries(LAMPS))
    tokens["remark_lamp_" + key] = key === state ? [icon, folder].filter(Boolean).join(" ") : "";
  // Lamp and directory share one colored token, avoiding Herdr's separator.
  // Publish the sequence even if tokens match, to invalidate older pending writes.
  herdr.cli(["pane", "report-metadata", pane.pane_id, "--source", "plugin:" + herdr.ID,
    "--clear-state-labels", "--seq", (seq + 1n).toString(),
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
  update(pane);
}

function refresh(panes, known = {}) {
  if (!panes.length) return;
  // A tab or Git lookup costs about as much as a Herdr round trip, so fetch each
  // distinct one once per batch instead of once per pane. An unlabeled tab maps
  // to "" rather than undefined, which would trigger a per-pane fallback lookup.
  const tabs = known.tabLabel === undefined
    ? new Map((herdr.cli(["tab", "list"]).tabs || []).map(tab => [tab.tab_id, tab.label]))
    : null;
  const branches = new Map();
  for (const pane of panes) {
    if (!branches.has(pane.cwd)) branches.set(pane.cwd, herdr.branch(pane.cwd));
    update(pane, undefined, { branch: branches.get(pane.cwd),
      tabLabel: known.tabLabel ?? tabs.get(pane.tab_id) ?? "" });
  }
}

function event() {
  const envelope = herdr.envJson("HERDR_PLUGIN_EVENT_JSON");
  const data = envelope.data || envelope;
  const name = process.env.HERDR_PLUGIN_EVENT || envelope.event;
  if (name === "tab.renamed") {
    const tabId = data.tab_id || data.tab?.tab_id;
    // The payload already carries the new label, so the batch needs no tab lookup.
    // A payload without a label field falls back to the shared tab lookup.
    const panes = (herdr.cli(["agent", "list"]).agents || []).filter(pane => pane.tab_id === tabId);
    refresh(panes, Object.hasOwn(data, "label") ? { tabLabel: data.label ?? "" } : {});
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
    refresh(herdr.cli(["agent", "list"]).agents || []);
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
