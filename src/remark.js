"use strict";

const herdr = require("./herdr");
const blink = require("./blink");
const { clean } = require("./text");
const { DATA_SOURCE, LAMP_SOURCE, READ_SOURCE, ACTIVITY_SOURCE, DATA_TOKENS, READ_TOKENS,
  isUnread, lampTokens, readTokens, completion, sessionKey, sessionChanged,
  activity, pendingWork, activityTokens, sameReadState } = require("./tokens");

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
      pane.agent_session = agent.agent_session;
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
function update(pane, unread, { acknowledgeFocus = false } = {}) {
  let seq = herdr.sequence();
  const activitySeq = seq;
  let expected = pane.state_change_seq !== undefined || pane.completion_seq !== undefined ? structuredClone(pane) : null;
  let live = readPane(pane.pane_id);
  if (!live) return false;
  if (pane.terminal_id && pane.terminal_id !== live.terminal_id) return false;
  if (pane.agent_session && live.agent_session && sessionKey(pane) !== sessionKey(live)) return false;
  expected ||= structuredClone(live);
  const previous = activity(live);
  const resetRead = sessionChanged(live) || (!previous && !!live.tokens?.remark_activity);
  if (resetRead && sessionKey(expected) !== sessionKey(live)) return false;
  // Initialize read state only without native completed work. A confirmed
  // first task remains unread even if its working snapshot was not observed.
  const initial = !previous || (previous[2] === "unknown" && previous[3] == null && !pendingWork(previous));
  const record = live.agent && activityTokens(live);
  const baseline = !!record && (resetRead || (initial && completion(live) === undefined && !live.tokens?.remark_unread &&
    ["idle", "done"].includes(live.agent_status)));
  if (record && !baseline) {
    report(live.pane_id, ACTIVITY_SOURCE, seq, record);
    live.tokens = { ...live.tokens, ...record };
  }
  if (live.agent && (unread !== undefined || acknowledgeFocus || baseline)) {
    live = readPane(pane.pane_id);
    if (!live) return false;
    if (expected.terminal_id && expected.terminal_id !== live.terminal_id) return false;
    const desired = acknowledgeFocus && live.focused ? false : unread ?? (baseline ? false : undefined);
    // A delayed gesture belongs to the round and manual mark it observed.
    if (live.agent && desired !== undefined && (desired || sameReadState(expected, live))) {
      const target = resetRead ? { ...live, tokens: { ...live.tokens, remark_seen: null } } : live;
      const tokens = resetRead && unread === undefined && !(acknowledgeFocus && live.focused)
        ? Object.fromEntries(READ_TOKENS.map(key => [key, null])) : readTokens(target, desired, seq);
      report(live.pane_id, READ_SOURCE, seq, tokens);
      // Render the accepted state, even if this action lost to a newer action.
      seq = herdr.sequence();
      if (!baseline) {
        live = readPane(pane.pane_id);
        if (!live) return false;
      }
    }
  }
  if (baseline) {
    // Finalize initialization only after its read write succeeds. A failed
    // write leaves the first snapshot retryable. Retain the original activity
    // clock so this delayed publication cannot replace a newer hook's record.
    const established = live.agent && activityTokens(live);
    if (established) report(live.pane_id, ACTIVITY_SOURCE, activitySeq, established);
    live = readPane(pane.pane_id);
    if (!live) return false;
  }
  if (!live.agent) {
    report(live.pane_id, READ_SOURCE, seq, Object.fromEntries(READ_TOKENS.map(key => [key, null])));
    report(live.pane_id, ACTIVITY_SOURCE, seq, { remark_activity: null, remark_round: null, remark_session: null });
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
  return isUnread(readPane(pane.pane_id) || pane);
}

function saveNote(terminalId, note, expectedSession) {
  const target = herdr.paneForTerminal(terminalId);
  // Keep the round observed before the rename; saving can race a completion.
  const pane = readPane(target.pane_id);
  if (!pane?.agent || pane.terminal_id !== terminalId) throw new Error("目标 Agent 已关闭，未保存备注。");
  if (expectedSession && expectedSession !== sessionKey(pane)) throw new Error("目标 Agent 会话已切换，未保存备注。");
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
    // A name change, including one made by another plugin, is not evidence
    // that any result in the Tab was viewed.
    refresh(panes);
    return;
  }
  const id = data.pane_id || data.pane?.pane_id;
  if (id) {
    update({ pane_id: id }, undefined, { acknowledgeFocus: name === "pane.focused" });
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
