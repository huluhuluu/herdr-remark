"use strict";

const herdr = require("./herdr");
const blink = require("./blink");
const { clean } = require("./text");
const { DATA_SOURCE, LAMP_SOURCE, READ_SOURCE, ACTIVITY_SOURCE, DATA_TOKENS, READ_TOKENS,
  isUnread, lampTokens, readTokens, activityTokens } = require("./tokens");

function initialNote(pane) {
  return clean(pane.label || pane.tokens?.summary || pane.terminal_title_stripped || pane.title || "");
}

function readPane(id) {
  let pane;
  try { pane = herdr.cli(["pane", "get", id]).pane; }
  catch (error) { if (error.code === "pane_not_found") return; throw error; }
  // AgentInfo exposes lifecycle generations even when Herdr calls a completion
  // idle because the Tab was already active. PaneInfo does not carry them.
  if (pane?.agent) {
    const agent = (herdr.cli(["agent", "list"]).agents || []).find(item =>
      item.pane_id === id && item.terminal_id === pane.terminal_id);
    if (agent) {
      pane.agent_status = agent.agent_status;
      pane.focused = agent.focused;
      pane.state_change_seq = agent.state_change_seq;
      pane.completion_seq = agent.completion_seq;
      pane.tokens = agent.tokens;
    }
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
  let live = readPane(pane.pane_id);
  if (!live) return false;
  if (pane.terminal_id && pane.terminal_id !== live.terminal_id) return false;
  const activity = live.agent && activityTokens(live);
  if (activity) {
    report(live.pane_id, ACTIVITY_SOURCE, seq, activity);
    live.tokens = { ...live.tokens, ...activity };
  }
  if (live.agent && unread !== undefined) {
    report(live.pane_id, READ_SOURCE, seq, readTokens(live, unread, seq));
    // Render the accepted state, even if this action lost to a newer action.
    seq = herdr.sequence();
    live = readPane(pane.pane_id);
    if (!live) return false;
  }
  if (!live.agent) {
    report(live.pane_id, READ_SOURCE, seq, Object.fromEntries(READ_TOKENS.map(key => [key, null])));
    report(live.pane_id, ACTIVITY_SOURCE, seq, { remark_activity: null });
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
  const watchUnread = isUnread(live);
  if (live.agent_status === "working" || watchUnread) blink.start(process.env, watchUnread);
  return true;
}

function toggle(pane) {
  pane = readPane(pane.pane_id) || pane;
  const unread = !isUnread(pane);
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
    const panes = (herdr.cli(["agent", "list"]).agents || []).filter(pane => pane.tab_id === tabId);
    if (!panes.length) return;
    const tab = herdr.cli(["tab", "list", "--workspace", panes[0].workspace_id])
      .tabs?.find(item => item.tab_id === tabId);
    // An older rename may be delivered after another rename. It still refreshes
    // metadata, but must not acknowledge the current name's unread state.
    refresh(panes, tab && typeof data.label === "string" && data.label === (tab.label ?? "") ? false : undefined);
    return;
  }
  const id = data.pane_id || data.pane?.pane_id;
  if (id) {
    let unread;
    if (name === "pane.focused") {
      const pane = readPane(id);
      if (pane?.focused) unread = false;
    }
    update({ pane_id: id }, unread);
  }
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

module.exports = { initialNote, update, toggle, saveNote, refresh, main };
