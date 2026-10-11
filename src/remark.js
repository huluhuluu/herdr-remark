"use strict";

const herdr = require("./herdr");
const blink = require("./blink");
const { clean, directory } = require("./text");
const { DATA_SOURCE, LAMP_SOURCE, READ_SOURCE, DATA_TOKENS, READ_TOKENS,
  stateOf, lampTokens, readTokens } = require("./tokens");

function initialNote(pane) {
  return clean(pane.label || pane.tokens?.summary || pane.terminal_title_stripped || pane.title || "");
}

function readPane(id) {
  const pane = herdr.cli(["pane", "get", id]).pane;
  // Only agent.list exposes the completion generation. Remember which turn was
  // viewed rather than treating all future completions as read.
  if (pane?.agent_status === "done") {
    const agent = (herdr.cli(["agent", "list"]).agents || []).find(item =>
      item.pane_id === id && item.terminal_id === pane.terminal_id && item.agent_status === "done");
    if (agent) pane.state_change_seq = agent.state_change_seq;
  }
  return pane;
}

function report(id, source, seq, tokens) {
  herdr.cli(["pane", "report-metadata", id, "--source", source, "--seq", String(seq),
    ...Object.entries(tokens).flatMap(([key, value]) => value == null || value === ""
      ? ["--clear-token", key] : ["--token", key + "=" + value])]);
}

// Resolve the current pane, Git branch and Tab label on every refresh. Events
// and earlier batch snapshots identify the target, not its display values.
function update(pane, unread) {
  let seq = herdr.sequence();
  let live;
  try { live = readPane(pane.pane_id); }
  catch (error) { if (error.code === "pane_not_found") return false; throw error; }
  if (!live) return false;
  if (live.agent && unread !== undefined) {
    report(live.pane_id, READ_SOURCE, seq, readTokens(live, unread));
    // Render the accepted state, even if this action lost to a newer action.
    seq = herdr.sequence();
    try { live = readPane(pane.pane_id); }
    catch (error) { if (error.code === "pane_not_found") return false; throw error; }
    if (!live) return false;
  }
  if (!live.agent) {
    report(live.pane_id, READ_SOURCE, seq, Object.fromEntries(READ_TOKENS.map(key => [key, null])));
    report(live.pane_id, DATA_SOURCE, seq, Object.fromEntries(DATA_TOKENS.map(key => [key, null])));
    report(live.pane_id, LAMP_SOURCE, seq, lampTokens(live));
    return true;
  }
  const branch = clean(herdr.branch(live.cwd));
  const tab = herdr.cli(["tab", "list", "--workspace", live.workspace_id])
    .tabs?.find(item => item.tab_id === live.tab_id);
  report(live.pane_id, DATA_SOURCE, seq, {
    remark_tab: clean(tab?.label), remark_branch: branch, remark_note: clean(live.label),
  });
  report(live.pane_id, LAMP_SOURCE, seq, lampTokens(live));
  if (live.agent_status === "working" || live.tokens?.remark_unread || stateOf(live) === "unread") {
    try { blink.start(process.env, !!live.tokens?.remark_unread || stateOf(live) === "unread"); }
    catch { /* the next event can start the monitor again */ }
  }
  return true;
}

function toggle(pane) {
  if (pane.agent_status === "done") pane = readPane(pane.pane_id) || pane;
  const unread = !(pane.tokens?.remark_unread || stateOf(pane) === "unread");
  if (!unread && pane.agent_status === "done") herdr.cli(["agent", "focus", pane.pane_id]);
  update(pane, unread);
  return unread;
}

function saveNote(terminalId, note) {
  const pane = herdr.paneForTerminal(terminalId);
  const value = clean(note);
  // Herdr trims names; a leading space keeps a literal '--clear' from being an option.
  herdr.cli(["pane", "rename", pane.pane_id, value ? " " + value : "--clear"]);
  update(pane, false);
}

function refresh(panes, unread) {
  const failures = [];
  for (const pane of panes) {
    try { update(pane, unread); }
    catch (error) {
      if (error.code !== "pane_not_found") failures.push(`${pane.pane_id}: ${error.message}`);
    }
  }
  if (failures.length) throw new Error(failures.join("\n"));
}

// Let Herdr supply its actual plugin paths. Wait for the command result so an
// asynchronous action invocation cannot make a failed initialization look OK.
async function reload() {
  let { log } = herdr.cli(["plugin", "action", "invoke", "refresh", "--plugin", herdr.ID]);
  const id = log.log_id;
  const deadline = Date.now() + 25000;
  while (log.status === "running") {
    if (Date.now() >= deadline) throw new Error(`初始化超时；查看 herdr plugin log list --plugin ${herdr.ID}`);
    await new Promise(resolve => setTimeout(resolve, 200));
    log = herdr.cli(["plugin", "log", "list", "--plugin", herdr.ID, "--limit", "100"])
      .logs?.find(item => item.log_id === id);
    if (!log) throw new Error(`找不到初始化日志：${id}`);
  }
  if (log.status !== "succeeded") throw new Error(log.stderr || log.error || `初始化失败：${log.status}`);
}

function event() {
  const envelope = herdr.envJson("HERDR_PLUGIN_EVENT_JSON");
  const data = envelope.data || envelope;
  const name = process.env.HERDR_PLUGIN_EVENT || envelope.event;
  if (name === "tab.renamed") {
    const tabId = data.tab_id || data.tab?.tab_id;
    refresh((herdr.cli(["agent", "list"]).agents || []).filter(pane => pane.tab_id === tabId), false);
    return;
  }
  const id = data.pane_id || data.pane?.pane_id;
  if (id) update({ pane_id: id }, name === "pane.focused" ? false : undefined);
}

function main(command = process.argv[2]) {
  if (command === "reload") return reload();
  if (command === "init") {
    blink.requestReload();
    refresh(herdr.cli(["agent", "list"]).agents || []);
    return;
  }
  if (command === "event") {
    return event();
  }
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
  Promise.resolve().then(() => main()).catch(e => {
    process.stderr.write("remark: " + e.message + "\n");
    process.exitCode = 1;
  });
}

module.exports = { clean, initialNote, directory, stateOf, update, toggle, saveNote, refresh, main };
