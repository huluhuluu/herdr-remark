"use strict";

const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const herdr = require("../src/herdr");
const remark = require("../src/remark");
const originalCli = herdr.cli;
const originalResolve = herdr.paneForTerminal;
const originalEvent = process.env.HERDR_PLUGIN_EVENT;
const originalJson = process.env.HERDR_PLUGIN_EVENT_JSON;

afterEach(() => {
  herdr.cli = originalCli;
  herdr.paneForTerminal = originalResolve;
  for (const [name, value] of [["HERDR_PLUGIN_EVENT", originalEvent],
    ["HERDR_PLUGIN_EVENT_JSON", originalJson]]) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function fixture(status = "idle") {
  const pane = { pane_id: "w1:p1", terminal_id: "terminal-a", agent: "codex",
    agent_status: status, state_labels: {} };
  const calls = [];
  herdr.cli = args => {
    calls.push(args);
    if (args[1] === "get") return { pane };
    if (args[1] === "focus") pane.agent_status = "idle";
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--state-label") {
        const [state, label] = args[++i].split("=");
        pane.state_labels[state] = label;
      }
    }
    return {};
  };
  return { pane, calls };
}

test("manual unread survives status changes and toggles back without modifying lifecycle", () => {
  const { pane, calls } = fixture("working");
  assert.equal(remark.toggle(pane), true);
  assert.equal(pane.state_labels.working, "unread");
  pane.agent_status = "blocked";
  assert.equal(pane.state_labels.blocked, "unread");
  assert.equal(remark.toggle(pane), false);
  assert.equal(pane.state_labels.blocked, "read");
  assert.equal(pane.agent_status, "blocked");
  assert.ok(calls.every(args => args[1] === "report-metadata"));
});

test("native completion follows Herdr and is acknowledged through focus", () => {
  const { pane, calls } = fixture("done");
  assert.equal(remark.toggle(pane), false);
  assert.equal(pane.agent_status, "idle");
  assert.deepEqual(calls[0], ["agent", "focus", "w1:p1"]);
  assert.equal(pane.state_labels.idle, "read");
  assert.equal(pane.state_labels.done, "unread");
});

test("focus clears manual unread while detection preserves it", () => {
  const { pane } = fixture();
  remark.toggle(pane);
  process.env.HERDR_PLUGIN_EVENT_JSON = JSON.stringify({ data: { pane_id: pane.pane_id } });
  process.env.HERDR_PLUGIN_EVENT = "pane.agent_detected";
  remark.main("event");
  assert.equal(pane.state_labels.idle, "unread");
  process.env.HERDR_PLUGIN_EVENT = "pane.focused";
  remark.main("event");
  assert.equal(pane.state_labels.idle, "read");
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
