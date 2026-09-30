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
    cwd: "C:\\work\\repo", agent: "codex", agent_status: status, revision: 1, state_labels: {}, tokens: {} };
  const calls = [];
  let lastSeq = -1n;
  herdr.branch = () => "main";
  herdr.cli = args => {
    calls.push(args);
    if (args[0] === "tab") return { tabs: [{ tab_id: "w1:t1", label: "Build" }] };
    if (args[0] === "agent" && args[1] === "list") return { agents: [pane] };
    if (args[1] === "get") return { pane };
    if (args[1] === "focus") pane.agent_status = "idle";
    if (args[1] === "rename") {
      pane.label = args[3] === "--clear" ? undefined : args[3].trim();
    }
    if (args.includes("--seq")) {
      const seq = BigInt(args[args.indexOf("--seq") + 1]);
      if (seq <= lastSeq) return {};
      lastSeq = seq;
    }
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--clear-state-labels") pane.state_labels = {};
      if (args[i] === "--clear-token") delete pane.tokens[args[++i]];
      if (args[i] === "--token") { const [key, ...rest] = args[++i].split("="); pane.tokens[key] = rest.join("="); }
    }
    if (args[1] === "report-metadata") pane.revision++;
    return {};
  };
  return { pane, calls };
}
test("status lamp combines native state and idle unread", () => {
  const { pane } = fixture();
  for (const [status, unread, lamp, icon] of [
    ["working", false, "working", "●"], ["working", true, "working", "●"],
    ["blocked", false, "blocked", "●"], ["blocked", true, "blocked", "●"],
    ["idle", false, "idle", "○"], ["idle", true, "unread", "●"],
    ["done", false, "unread", "●"], ["unknown", true, "unknown", "·"],
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
  assert.equal(pane.tokens.remark_lamp_unread, "● repo");
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
  const tokens = { ...pane.tokens };
  remark.update(pane);
  assert.deepEqual(pane.tokens, tokens);
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
  // OSC and non-CSI escapes must not leak their payload as visible text.
  assert.equal(remark.clean("\x1b]0;window title\x07hello"), "hello");
  assert.equal(remark.clean("\x1b]0;title\x1b\\hello"), "hello");
  assert.equal(remark.clean("\x1b(Bascii"), "Bascii");
  assert.equal(Array.from(remark.clean("😀".repeat(100))).length, 80);
  const { pane, calls } = fixture();
  herdr.paneForTerminal = id => { assert.equal(id, "term"); return pane; };
  remark.update(pane, true);
  remark.saveNote("term", "new note");
  assert.equal(pane.tokens.remark_note, "new note");
  assert.equal(pane.tokens.remark_unread, "1");
  remark.saveNote("term", "--clear");
  assert.equal(pane.tokens.remark_note, "--clear");
  remark.saveNote("term", "");
  assert.equal(pane.tokens.remark_note, undefined);
  assert.deepEqual(calls.filter(args => args[1] === "rename").map(args => args.slice(2)),
    [[pane.pane_id, " new note"], [pane.pane_id, " --clear"], [pane.pane_id, "--clear"]]);
  const count = calls.length;
  herdr.paneForTerminal = () => { throw Error("closed"); };
  assert.throws(() => remark.saveNote("term", "lost"), /closed/);
  assert.equal(calls.length, count);
});

test("malformed environment JSON names the variable instead of leaking a SyntaxError", () => {
  process.env.HERDR_PLUGIN_EVENT_JSON = "not json";
  assert.throws(() => herdr.envJson("HERDR_PLUGIN_EVENT_JSON"), /HERDR_PLUGIN_EVENT_JSON 不是合法的 JSON/);
  assert.throws(() => remark.main("event"), /HERDR_PLUGIN_EVENT_JSON 不是合法的 JSON/);
  process.env.HERDR_PLUGIN_EVENT_JSON = '{"data":{"pane_id":"w1:p1"}}';
  assert.deepEqual(herdr.envJson("HERDR_PLUGIN_EVENT_JSON").data, { pane_id: "w1:p1" });
  delete process.env.HERDR_PLUGIN_EVENT_JSON;
  assert.deepEqual(herdr.envJson("HERDR_PLUGIN_EVENT_JSON"), {});
});

test("slow refresh cannot restore unread or an old note after newer user actions", () => {
  const { pane } = fixture();
  pane.label = "Old note";
  remark.update(pane, true);
  const snapshot = structuredClone(pane);
  herdr.branch = () => {
    delete pane.tokens.remark_unread;
    pane.label = "New note";
    pane.revision++;
    return "main";
  };
  remark.update(snapshot);
  assert.equal(pane.tokens.remark_unread, undefined);
  assert.equal(pane.tokens.remark_note, "New note");
  assert.equal(pane.tokens.remark_lamp_idle, "○ repo");
});

test("a stale focus refresh cannot clear unread set after it started", () => {
  const { pane } = fixture();
  const cli = herdr.cli;
  let held = null;
  herdr.cli = args => {
    // Hold the stale process's unread write so it lands after the user's toggle.
    if (args[1] === "report-metadata" && !held &&
        args[args.indexOf("--clear-token") + 1] === "remark_unread") {
      held = args;
      return {};
    }
    return cli(args);
  };
  remark.update(pane, false);
  assert.ok(held, "expected the stale refresh to write the unread flag");
  remark.update(pane, true);
  assert.equal(pane.tokens.remark_unread, "1");
  cli(held);
  assert.equal(pane.tokens.remark_unread, "1");
});

test("an older in-flight report cannot overwrite a newer note or tab", () => {
  const { pane } = fixture();
  remark.update(pane);
  const cli = herdr.cli;
  let interleaved = false;
  herdr.cli = args => {
    if (args.includes("--seq") && !interleaved) {
      interleaved = true;
      pane.label = "Latest note";
      herdr.cli = next => next[0] === "tab"
        ? { tabs: [{ tab_id: pane.tab_id, label: "Latest tab" }] } : cli(next);
      remark.update(pane);
    }
    return cli(args);
  };
  pane.label = "Older note";
  remark.update(pane);
  assert.ok(interleaved);
  assert.equal(pane.tokens.remark_note, "Latest note");
  assert.equal(pane.tokens.remark_tab, "Latest tab");
});

test("a refresh with unchanged display still invalidates an older pending report", () => {
  const { pane } = fixture();
  pane.label = "Original note";
  remark.update(pane);
  const cli = herdr.cli;
  herdr.cli = args => {
    if (args.includes("--seq")) {
      herdr.cli = cli;
      pane.label = "Original note";
      remark.update(pane);
    }
    return cli(args);
  };
  pane.label = "Temporary note";
  remark.update(pane);
  assert.equal(pane.tokens.remark_note, "Original note");
});

// Minimal metadata applier for the batch tests, which drive several panes.
function applyMetadata(args, pane) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--clear-token") delete pane.tokens[args[++i]];
    if (args[i] === "--token") { const [key, ...rest] = args[++i].split("="); pane.tokens[key] = rest.join("="); }
  }
}

test("init fetches each tab label and Git branch once for the whole batch", () => {
  const panes = [
    { pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1", cwd: "C:\\work\\repo", agent: "codex", agent_status: "idle", tokens: {} },
    { pane_id: "w1:p2", tab_id: "w1:t1", workspace_id: "w1", cwd: "C:\\work\\repo", agent: "codex", agent_status: "idle", tokens: {} },
    { pane_id: "w1:p3", tab_id: "w1:t2", workspace_id: "w1", cwd: "C:\\work\\other", agent: "codex", agent_status: "idle", tokens: {} },
  ];
  const calls = [];
  const branchCwds = [];
  herdr.branch = cwd => { branchCwds.push(cwd); return "main"; };
  herdr.cli = args => {
    calls.push(args.join(" "));
    if (args[0] === "agent") return { agents: panes };
    if (args[0] === "tab") return { tabs: [{ tab_id: "w1:t1", label: "Build" }, { tab_id: "w1:t2" }] };
    if (args[1] === "get") return { pane: panes.find(p => p.pane_id === args[2]) };
    if (args[1] === "report-metadata") applyMetadata(args, panes.find(p => p.pane_id === args[2]));
    return {};
  };
  remark.main("init");
  assert.equal(calls.filter(c => c.startsWith("tab list")).length, 1);
  assert.deepEqual(branchCwds, ["C:\\work\\repo", "C:\\work\\other"]);
  assert.equal(calls.filter(c => c.startsWith("pane report-metadata")).length, 3);
  assert.equal(panes[0].tokens.remark_tab, "Build");
  assert.equal(panes[1].tokens.remark_tab, "Build");
  // An unlabeled tab clears the token instead of falling back to another lookup.
  assert.equal(panes[2].tokens.remark_tab, undefined);
});

test("a tab rename refreshes its agents from the payload without a tab lookup", () => {
  const pane = { pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1", cwd: "C:\\work\\repo",
    agent: "codex", agent_status: "idle", tokens: { remark_tab: "Old" } };
  const calls = [];
  herdr.branch = () => "main";
  herdr.cli = args => {
    calls.push(args.join(" "));
    if (args[0] === "agent") return { agents: [pane, { ...pane, pane_id: "w1:p9", tab_id: "w1:t9", tokens: {} }] };
    if (args[1] === "get") return { pane };
    if (args[1] === "report-metadata") applyMetadata(args, pane);
    return {};
  };
  process.env.HERDR_PLUGIN_EVENT = "tab.renamed";
  process.env.HERDR_PLUGIN_EVENT_JSON = JSON.stringify({ data: { tab_id: "w1:t1", label: "Renamed" } });
  remark.main("event");
  assert.equal(pane.tokens.remark_tab, "Renamed");
  assert.equal(calls.some(c => c.startsWith("tab list")), false);
  assert.equal(calls.filter(c => c.startsWith("pane get")).length, 1);

  // A payload without a label field still resolves it, once for the batch.
  process.env.HERDR_PLUGIN_EVENT_JSON = JSON.stringify({ data: { tab_id: "w1:t1" } });
  remark.main("event");
  assert.equal(calls.filter(c => c.startsWith("tab list")).length, 1);
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
