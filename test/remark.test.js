"use strict";
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const herdr = require("../src/herdr");
const remark = require("../src/remark");
const originals = { cli: herdr.cli, pane: herdr.paneForTerminal, branch: herdr.branch,
  event: process.env.HERDR_PLUGIN_EVENT, json: process.env.HERDR_PLUGIN_EVENT_JSON };
afterEach(() => {
  Object.assign(herdr, { cli: originals.cli, paneForTerminal: originals.pane, branch: originals.branch });
  for (const [key, value] of [["HERDR_PLUGIN_EVENT", originals.event], ["HERDR_PLUGIN_EVENT_JSON", originals.json]])
    value === undefined ? delete process.env[key] : process.env[key] = value;
});
function fixture(status = "idle") {
  const pane = { pane_id: "w1:p1", terminal_id: "term", workspace_id: "w1", tab_id: "w1:t1",
    cwd: "C:\\work\\repo", agent: "codex", agent_status: status, state_labels: {}, tokens: {} };
  const calls = [];
  herdr.branch = () => "main";
  herdr.cli = args => {
    calls.push(args);
    if (args[0] === "tab") return { tabs: [{ tab_id: "w1:t1", label: "Build" }] };
    if (args[0] === "agent" && args[1] === "list") return { agents: [pane] };
    if (args[1] === "get") return { pane };
    if (args[1] === "focus") pane.agent_status = "idle";
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--clear-state-labels") pane.state_labels = {};
      if (args[i] === "--clear-token") delete pane.tokens[args[++i]];
      if (args[i] === "--token") { const [key, ...rest] = args[++i].split("="); pane.tokens[key] = rest.join("="); }
    }
    return {};
  };
  return { pane, calls };
}
test("status lamp combines native state and idle unread", () => {
  const { pane } = fixture();
  for (const [status, unread, lamp, icon] of [
    ["working", false, "working", "●"], ["working", true, "working", "●"],
    ["blocked", false, "blocked", "●"], ["blocked", true, "blocked", "●"],
    ["idle", false, "idle", "○"], ["idle", true, "unread", "○"],
    ["done", false, "unread", "○"], ["unknown", true, "unknown", "·"],
    ["unrecognized", false, "unknown", "·"],
  ]) {
    pane.agent_status = status;
    remark.update(pane, unread);
    assert.deepEqual(Object.entries(pane.tokens).filter(([key]) => key.startsWith("remark_lamp_")),
      [["remark_lamp_" + lamp, icon + " repo"]], `${status}, unread=${unread}`);
    assert.equal(pane.agent_status, status);
  }
});
test("toggle leaves lifecycle state unchanged and focus clears unread", () => {
  const { pane } = fixture("blocked"); assert.equal(remark.toggle(pane), true); assert.equal(pane.agent_status, "blocked");
  process.env.HERDR_PLUGIN_EVENT = "pane.agent_status_changed";
  process.env.HERDR_PLUGIN_EVENT_JSON = JSON.stringify({ pane_id: pane.pane_id });
  pane.agent_status = "idle";
  remark.main("event");
  assert.equal(pane.tokens.remark_lamp_unread, "○ repo");
  pane.agent_status = "blocked";
  process.env.HERDR_PLUGIN_EVENT = "pane.focused"; process.env.HERDR_PLUGIN_EVENT_JSON = JSON.stringify({ data: { pane_id: pane.pane_id } });
  remark.main("event"); assert.equal(pane.tokens.remark_unread, undefined); assert.equal(pane.tokens.remark_lamp_blocked, "● repo");
});
test("native completion is acknowledged and unused metadata is cleared", () => {
  const { pane, calls } = fixture("done");
  pane.state_labels = { idle: "read|Old|branch" };
  assert.equal(remark.toggle(pane), false);
  assert.deepEqual(calls[0], ["agent", "focus", pane.pane_id]);
  assert.equal(pane.tokens.remark_lamp_idle, "○ repo");
  assert.deepEqual(pane.state_labels, {});
  const writes = calls.filter(args => args[1] === "report-metadata").length;
  remark.update(pane);
  assert.equal(calls.filter(args => args[1] === "report-metadata").length, writes);
});
test("layout metadata is compact and omits an absent branch", () => {
  const { pane } = fixture(); herdr.branch = () => ""; remark.update(pane, false);
  assert.equal(pane.tokens.remark_lamp_idle, "○ repo"); assert.equal(pane.tokens.remark_branch, undefined); assert.equal(pane.tokens.remark_note, undefined);
  assert.equal(pane.tokens.remark_tab, "Build");
  pane.cwd = "";
  remark.update(pane, false);
  assert.equal(pane.tokens.remark_lamp_idle, "○");
});
test("note cleaning and terminal identity remain bounded", () => {
  assert.equal(remark.clean("  hello\n\x1b[31m世界\x1b[0m  "), "hello 世界");
  assert.equal(Array.from(remark.clean("😀".repeat(100))).length, 80);
  herdr.paneForTerminal = id => ({ pane_id: id }); const calls = []; herdr.cli = args => calls.push(args);
  remark.saveNote("term", "new note"); assert.deepEqual(calls[0], ["pane", "rename", "term", " new note"]);
  assert.deepEqual(calls[1].slice(-2), ["--token", "remark_note=new note"]);
  remark.saveNote("term", "--clear");
  assert.deepEqual(calls[2], ["pane", "rename", "term", " --clear"]);
  remark.saveNote("term", "");
  assert.deepEqual(calls[4], ["pane", "rename", "term", "--clear"]);
  assert.deepEqual(calls[5].slice(-2), ["--clear-token", "remark_note"]);
  herdr.paneForTerminal = () => { throw Error("closed"); };
  assert.throws(() => remark.saveNote("term", "lost"), /closed/);
  assert.equal(calls.length, 6);
});

test("directories and note defaults use actual names", () => {
  for (const [cwd, name] of [["C:\\work\\repo\\", "repo"], ["/work/repo/", "repo"],
    ["/", "/"], ["", ""], ["\\\\server\\share\\repo", "repo"]])
    assert.equal(remark.directory(cwd), name);
  const pane = { label: "Note", tokens: { summary: "Summary" }, terminal_title_stripped: "Title" };
  assert.equal(remark.initialNote(pane), "Note");
  delete pane.label;
  assert.equal(remark.initialNote(pane), "Summary");
  delete pane.tokens;
  assert.equal(remark.initialNote(pane), "Title");
});
