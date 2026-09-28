"use strict";

const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const herdr = require("../src/herdr");
const remark = require("../src/remark");
const originalCli = herdr.cli;
const originalResolve = herdr.paneForTerminal;
const originalBranch = herdr.branch;
const originalEvent = process.env.HERDR_PLUGIN_EVENT;
const originalJson = process.env.HERDR_PLUGIN_EVENT_JSON;

afterEach(() => {
  herdr.cli = originalCli;
  herdr.paneForTerminal = originalResolve;
  herdr.branch = originalBranch;
  for (const [name, value] of [["HERDR_PLUGIN_EVENT", originalEvent],
    ["HERDR_PLUGIN_EVENT_JSON", originalJson]]) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function fixture(status = "idle") {
  const pane = { pane_id: "w1:p1", terminal_id: "terminal-a", agent: "codex",
    agent_status: status, workspace_id: "w1", tab_id: "w1:t1", state_labels: {}, tokens: {} };
  const tab = { tab_id: "w1:t1", label: "Task" };
  herdr.branch = () => "main";
  const calls = [];
  herdr.cli = args => {
    calls.push(args);
    if (args[0] === "tab") return { tabs: [tab] };
    if (args[0] === "agent" && args[1] === "list") return { agents: [pane] };
    if (args[1] === "get") return { pane };
    if (args[1] === "focus") pane.agent_status = "idle";
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--clear-state-labels") pane.state_labels = {};
      if (args[i] === "--state-label") {
        const [key, value] = args[++i].split("=");
        pane.state_labels[key] = value;
      }
      if (args[i] === "--clear-token") delete pane.tokens[args[++i]];
      if (args[i] === "--token") {
        const [key, value] = args[++i].split("=");
        pane.tokens[key] = value;
      }
    }
    return {};
  };
  return { pane, tab, calls };
}

test("manual unread survives status changes and toggles back without modifying lifecycle", () => {
  const { pane, calls } = fixture("working");
  assert.equal(remark.toggle(pane), true);
  assert.equal(pane.tokens.remark_unread, "● unread");
  assert.equal(pane.state_labels.working, "working|Task|main");
  pane.agent_status = "blocked";
  process.env.HERDR_PLUGIN_EVENT_JSON = JSON.stringify({ data: { pane_id: pane.pane_id } });
  process.env.HERDR_PLUGIN_EVENT = "pane.agent_status_changed";
  remark.main("event");
  assert.equal(pane.tokens.remark_unread, "● unread");
  assert.equal(remark.toggle(pane), false);
  assert.equal(pane.tokens.remark_unread, undefined);
  assert.equal(pane.state_labels.blocked, "blocked|Task|main");
  assert.equal(pane.agent_status, "blocked");
  assert.ok(calls.every(args => ["report-metadata", "get", "list"].includes(args[1])));
});

test("native completion follows Herdr and is acknowledged through focus", () => {
  const { pane, calls } = fixture("done");
  assert.equal(remark.toggle(pane), false);
  assert.equal(pane.agent_status, "idle");
  assert.deepEqual(calls[0], ["agent", "focus", "w1:p1"]);
  assert.equal(pane.state_labels.idle, "read|Task|main");
  assert.equal(pane.tokens.remark_unread, undefined);
});

test("focus clears manual unread while detection preserves it", () => {
  const { pane } = fixture();
  remark.toggle(pane);
  process.env.HERDR_PLUGIN_EVENT_JSON = JSON.stringify({ data: { pane_id: pane.pane_id } });
  process.env.HERDR_PLUGIN_EVENT = "pane.agent_detected";
  remark.main("event");
  assert.equal(pane.tokens.remark_unread, "● unread");
  process.env.HERDR_PLUGIN_EVENT = "pane.focused";
  remark.main("event");
  assert.equal(pane.state_labels.idle, "read|Task|main");
  assert.equal(pane.tokens.remark_unread, undefined);
});

test("native status labels remain available alongside manual unread", () => {
  const { pane, calls } = fixture();
  process.env.HERDR_PLUGIN_EVENT_JSON = JSON.stringify({ pane_id: pane.pane_id });
  process.env.HERDR_PLUGIN_EVENT = "pane.agent_status_changed";
  for (const [status, label] of [
    ["working", "working"], ["blocked", "blocked"],
    ["done", "unread"], ["idle", "read"], ["unknown", "unknown"],
  ]) {
    pane.agent_status = status;
    remark.main("event");
    assert.equal(pane.state_labels[status], label + "|Task|main");
    assert.equal(pane.agent_status, status);
    assert.deepEqual(pane.tokens, {});
  }
  const count = calls.filter(args => args[1] === "report-metadata").length;
  remark.setUnread(pane, false);
  assert.equal(calls.filter(args => args[1] === "report-metadata").length, count);
});

test("migration preserves manual unread and restores distinct native labels", () => {
  const { pane } = fixture("blocked");
  pane.state_labels = { idle: "unread", blocked: "unread" };
  process.env.HERDR_PLUGIN_EVENT_JSON = JSON.stringify({ pane_id: pane.pane_id });
  process.env.HERDR_PLUGIN_EVENT = "pane.agent_detected";
  remark.main("event");
  assert.equal(pane.state_labels.blocked, "blocked|Task|main");
  assert.equal(pane.tokens.remark_unread, "● unread");
});

test("tab rename and branch refresh keep compact labels without empty separators", () => {
  const { pane, tab } = fixture();
  remark.toggle(pane);
  tab.label = "Renamed";
  herdr.branch = () => "";
  process.env.HERDR_PLUGIN_EVENT = "tab.renamed";
  process.env.HERDR_PLUGIN_EVENT_JSON = JSON.stringify({ data: { tab } });
  remark.main("event");
  assert.equal(pane.state_labels.working, "working|Renamed");
  assert.equal(pane.tokens.remark_unread, "● unread");
});

test("note prefill prefers manual name, then summary, then conversation title", () => {
  const pane = { label: "Existing", tokens: { summary: "Summary" },
    terminal_title_stripped: "Conversation" };
  assert.equal(remark.initialNote(pane), "Existing");
  delete pane.label;
  assert.equal(remark.initialNote(pane), "Summary");
  delete pane.tokens;
  assert.equal(remark.initialNote(pane), "Conversation");
  assert.equal(remark.initialNote({}), "");
});

test("note cleaning preserves code points and removes terminal controls", () => {
  assert.equal(remark.clean("  hello\n\x1b[31m世界\x1b[0m  "), "hello 世界");
  assert.equal(Array.from(remark.clean("😀".repeat(100))).length, 80);
});

test("saving follows terminal identity and never changes read state", () => {
  const calls = [];
  herdr.paneForTerminal = id => {
    assert.equal(id, "terminal-a");
    return { pane_id: "w2:p7" };
  };
  herdr.cli = args => calls.push(args);
  remark.saveNote("terminal-a", "new note");
  remark.saveNote("terminal-a", "--clear");
  remark.saveNote("terminal-a", "");
  assert.deepEqual(calls, [
    ["pane", "rename", "w2:p7", " new note"],
    ["pane", "rename", "w2:p7", " --clear"],
    ["pane", "rename", "w2:p7", "--clear"],
  ]);
});

test("closed target aborts saving instead of changing another focused agent", () => {
  herdr.paneForTerminal = () => { throw new Error("closed"); };
  herdr.cli = () => assert.fail("must not write");
  assert.throws(() => remark.saveNote("closed-terminal", "note"), /closed/);
});
