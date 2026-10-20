"use strict";
const { test, afterEach, after } = require("node:test");
const assert = require("node:assert/strict");
const herdr = require("../src/herdr");
const remark = require("../src/remark");
const { clean, directory } = require("../src/text");
const { LAMP_SOURCE, READ_SOURCE } = require("../src/tokens");
// A fixture that reports a working agent must not spawn a real blink daemon
// against whatever Herdr server happens to be running on this machine, so the
// suite runs as though the plugin had no socket.
const liveSocket = process.env.HERDR_SOCKET_PATH;
delete process.env.HERDR_SOCKET_PATH;
after(() => { if (liveSocket !== undefined) process.env.HERDR_SOCKET_PATH = liveSocket; });
const originals = { cli: herdr.cli, pane: herdr.paneForTerminal, branch: herdr.branch,
  event: process.env.HERDR_PLUGIN_EVENT, json: process.env.HERDR_PLUGIN_EVENT_JSON };
afterEach(() => {
  Object.assign(herdr, { cli: originals.cli, paneForTerminal: originals.pane, branch: originals.branch });
  for (const [key, value] of [["HERDR_PLUGIN_EVENT", originals.event], ["HERDR_PLUGIN_EVENT_JSON", originals.json]])
    value === undefined ? delete process.env[key] : process.env[key] = value;
});
function fixture(status = "idle") {
  const pane = { pane_id: "w1:p1", terminal_id: "term", workspace_id: "w1", tab_id: "w1:t1",
    cwd: "C:\\work\\repo", agent: "codex", agent_status: status, focused: true, revision: 1, state_labels: {}, tokens: {} };
  const calls = [];
  const lastSeq = new Map();
  herdr.branch = () => "main";
  herdr.cli = args => {
    calls.push(args);
    if (args[0] === "tab") return { tabs: [{ tab_id: "w1:t1", label: "Build" }] };
    if (args[0] === "agent" && args[1] === "list") return { agents: [structuredClone(pane)] };
    if (args[1] === "get") return { pane: structuredClone(pane) };
    if (args[1] === "focus") pane.agent_status = "idle";
    if (args[1] === "rename") {
      pane.label = args[3] === "--clear" ? undefined : args[3].trim();
    }
    if (args.includes("--seq")) {
      const seq = BigInt(args[args.indexOf("--seq") + 1]);
      const source = args[args.indexOf("--source") + 1];
      if (seq <= (lastSeq.get(source) ?? -1n)) return {};
      lastSeq.set(source, seq);
    }
    for (let i = 0; i < args.length; i++) {
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
    ["done", false, "unread", "●"], ["done", true, "unread", "●"],
    ["unknown", true, "unknown", "·"],
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
test("native completion is acknowledged without changing state labels", () => {
  const { pane, calls } = fixture("done");
  pane.state_change_seq = 1;
  pane.state_labels = { idle: "custom label" };
  assert.equal(remark.toggle(pane), false);
  assert.ok(calls.every(args => args[1] !== "focus"));
  assert.equal(pane.agent_status, "done");
  assert.equal(pane.tokens.remark_lamp_idle, "○ repo");
  assert.deepEqual(pane.state_labels, { idle: "custom label" });
  assert.ok(calls.every(args => !args.includes("--clear-state-labels")));
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

test("note and Tab renames acknowledge unread without changing the agent lifecycle", () => {
  for (const action of ["note", "tab"]) {
    for (const status of ["idle", "done", "working", "blocked"]) {
      const { pane } = fixture(status);
      pane.state_change_seq = 10;
      pane.tokens = { remark_unread: "1" };
      if (action === "note") {
        herdr.paneForTerminal = () => pane;
        remark.saveNote("term", "updated note");
      } else {
        process.env.HERDR_PLUGIN_EVENT = "tab.renamed";
        process.env.HERDR_PLUGIN_EVENT_JSON = JSON.stringify({ data: { tab_id: pane.tab_id, label: "Build" } });
        remark.main("event");
      }
      assert.equal(pane.agent_status, status);
      assert.equal(pane.tokens.remark_unread, undefined);
      const lamp = status === "done" ? "idle" : status;
      assert.ok(pane.tokens["remark_lamp_" + lamp], `${action}: ${status}`);
      if (status === "done") {
        assert.equal(pane.tokens.remark_seen, "10");
        pane.state_change_seq = 11;
        remark.update(pane);
        assert.equal(pane.tokens.remark_lamp_unread, "● repo");
      }
    }
  }
});

test("a failed note rename does not clear unread", () => {
  const { pane } = fixture();
  pane.tokens = { remark_unread: "1" };
  herdr.paneForTerminal = () => pane;
  herdr.cli = () => { throw Error("rename failed"); };
  assert.throws(() => remark.saveNote("term", "new note"), /rename failed/);
  assert.equal(pane.tokens.remark_unread, "1");
});
test("note cleaning and terminal identity remain bounded", () => {
  assert.equal(clean("  hello\n\x1b[31m世界\x1b[0m  "), "hello 世界");
  // OSC and non-CSI escapes must not leak their payload as visible text.
  assert.equal(clean("\x1b]0;window title\x07hello"), "hello");
  assert.equal(clean("\x1b]0;title\x1b\\hello"), "hello");
  assert.equal(clean("\x1b(Bascii"), "ascii");
  assert.equal(clean("\x1b)0text\x1b(B"), "text");
  assert.equal(Array.from(clean("😀".repeat(100))).length, 80);
  const { pane, calls } = fixture();
  herdr.paneForTerminal = id => { assert.equal(id, "term"); return pane; };
  remark.update(pane, true);
  remark.saveNote("term", "new note");
  assert.equal(pane.tokens.remark_note, "new note");
  assert.equal(pane.tokens.remark_unread, undefined);
  assert.equal(pane.tokens.remark_lamp_idle, "○ repo");
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
    herdr.branch = () => "main";
    pane.label = "New note";
    remark.update(pane, false);
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
  const mark = pane.tokens.remark_unread;
  assert.ok(mark);
  cli(held);
  assert.equal(pane.tokens.remark_unread, mark);
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

test("init checks the current Tab and branch for every pane", () => {
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
  assert.equal(calls.filter(c => c.startsWith("tab list")).length, 3);
  assert.deepEqual(branchCwds, ["C:\\work\\repo", "C:\\work\\repo", "C:\\work\\other"]);
  assert.equal(calls.filter(c => c.startsWith("pane report-metadata")).length, 6);
  assert.equal(panes[0].tokens.remark_tab, "Build");
  assert.equal(panes[1].tokens.remark_tab, "Build");
  // An unlabeled tab clears the token instead of falling back to another lookup.
  assert.equal(panes[2].tokens.remark_tab, undefined);
});

test("a Tab rename refreshes its agents from current state, not an old event label", () => {
  const pane = { pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1", cwd: "C:\\work\\repo",
    agent: "codex", agent_status: "idle", tokens: { remark_tab: "Old", remark_unread: "1" } };
  const calls = [];
  herdr.branch = () => "main";
  herdr.cli = args => {
    calls.push(args.join(" "));
    if (args[0] === "agent") return { agents: [pane, { ...pane, pane_id: "w1:p9", tab_id: "w1:t9", tokens: {} }] };
    if (args[0] === "tab") return { tabs: [{ tab_id: "w1:t1", label: "Current" }] };
    if (args[1] === "get") return { pane };
    if (args[1] === "report-metadata") applyMetadata(args, pane);
    return {};
  };
  process.env.HERDR_PLUGIN_EVENT = "tab.renamed";
  process.env.HERDR_PLUGIN_EVENT_JSON = JSON.stringify({ data: { tab_id: "w1:t1", label: "Renamed" } });
  remark.main("event");
  assert.equal(pane.tokens.remark_tab, "Current");
  assert.equal(pane.tokens.remark_unread, "1");
  assert.equal(pane.tokens.remark_lamp_unread, "● repo");
  assert.equal(calls.some(c => c.startsWith("pane report-metadata w1:p9 ")), false);
  assert.equal(calls.filter(c => c.startsWith("pane get")).length, 1);

  // A payload without a label field still resolves it, once for the batch.
  process.env.HERDR_PLUGIN_EVENT_JSON = JSON.stringify({ data: { tab_id: "w1:t1" } });
  remark.main("event");
  assert.equal(pane.tokens.remark_unread, "1");
});

test("a late focus hook for a pane that is no longer focused only refreshes metadata", () => {
  const { pane } = fixture();
  pane.focused = false;
  remark.update(pane, true);
  const mark = pane.tokens.remark_unread;
  process.env.HERDR_PLUGIN_EVENT = "pane.focused";
  process.env.HERDR_PLUGIN_EVENT_JSON = JSON.stringify({ data: { pane_id: pane.pane_id } });
  remark.main("event");
  assert.equal(pane.tokens.remark_unread, mark);
  assert.equal(pane.tokens.remark_lamp_unread, "● repo");
});

test("clearing a Tab label acknowledges its agents", () => {
  const { pane } = fixture();
  const cli = herdr.cli;
  herdr.cli = args => args[0] === "tab" ? { tabs: [{ tab_id: pane.tab_id }] } : cli(args);
  remark.update(pane, true);
  process.env.HERDR_PLUGIN_EVENT = "tab.renamed";
  process.env.HERDR_PLUGIN_EVENT_JSON = JSON.stringify({ data: { tab_id: pane.tab_id, label: "" } });
  remark.main("event");
  assert.equal(pane.tokens.remark_unread, undefined);
  assert.equal(pane.tokens.remark_tab, undefined);
  assert.equal(pane.tokens.remark_lamp_idle, "○ repo");
});

test("a focus hook uses the newer agent snapshot when focus changes between reads", () => {
  const { pane } = fixture();
  remark.update(pane, true);
  const mark = pane.tokens.remark_unread;
  const cli = herdr.cli;
  herdr.cli = args => args[0] === "agent" ? { agents: [{ ...pane, focused: false }] } : cli(args);
  process.env.HERDR_PLUGIN_EVENT = "pane.focused";
  process.env.HERDR_PLUGIN_EVENT_JSON = JSON.stringify({ data: { pane_id: pane.pane_id } });
  remark.main("event");
  assert.equal(pane.tokens.remark_unread, mark);
});

test("active-tab idle completions turn blue for each observed round on older Herdr", () => {
  for (const agent of ["codex", "dsh-tui", "dst", "claude", "opencode", "copilot", "custom-agent"]) {
    const { pane } = fixture("working");
    pane.agent = agent;
    pane.state_change_seq = 10;
    remark.update(pane);
    pane.agent_status = "idle";
    pane.state_change_seq = 11;
    remark.update(pane);
    assert.equal(pane.tokens.remark_lamp_unread, "● repo", agent);
    remark.update(pane); // Staying in the current Tab does not acknowledge it.
    assert.equal(pane.tokens.remark_lamp_unread, "● repo");
    remark.toggle(pane);
    assert.equal(pane.tokens.remark_lamp_idle, "○ repo");
    pane.agent_status = "blocked";
    pane.state_change_seq = 12;
    remark.update(pane);
    assert.equal(pane.tokens.remark_lamp_blocked, "● repo");
    pane.agent_status = "idle";
    pane.state_change_seq = 13;
    remark.update(pane);
    assert.equal(pane.tokens.remark_lamp_unread, "● repo");
  }
});

test("native completion_seq is independent of native seen state and state_change_seq", () => {
  const { pane, calls } = fixture("idle");
  pane.state_change_seq = 50;
  pane.completion_seq = 40;
  remark.update(pane);
  assert.equal(pane.tokens.remark_lamp_unread, "● repo");
  remark.toggle(pane);
  assert.equal(pane.tokens.remark_seen, "40");
  pane.state_change_seq = 51;
  remark.update(pane);
  assert.equal(pane.tokens.remark_lamp_idle, "○ repo");
  pane.completion_seq = 52;
  remark.update(pane);
  assert.equal(pane.tokens.remark_lamp_unread, "● repo");
  assert.ok(calls.every(args => args[1] !== "focus"));
});

test("native completion tracking, notes and manual unread use no Agent name whitelist", () => {
  for (const name of ["codex", "dsh-tui", "dst", "claude", "opencode", "copilot", "custom-agent"]) {
    const { pane, calls } = fixture("idle");
    Object.assign(pane, { agent: name, state_change_seq: 10, completion_seq: 9 });
    remark.update(pane);
    assert.equal(pane.tokens.remark_lamp_unread, "● repo", name);
    herdr.paneForTerminal = () => pane;
    remark.saveNote(pane.terminal_id, "reviewed");
    assert.equal(pane.tokens.remark_lamp_idle, "○ repo", name);
    assert.equal(pane.tokens.remark_note, "reviewed", name);
    remark.toggle(pane);
    assert.equal(pane.tokens.remark_lamp_unread, "● repo", name);
    pane.agent_status = "blocked";
    remark.update(pane);
    assert.equal(pane.tokens.remark_lamp_blocked, "● repo", name);
    assert.ok(calls.every(args => !["focus", "report-agent", "clear-agent"].includes(args[1])));
  }
});

test("idle alone and a replaced terminal do not invent a completion", () => {
  const { pane } = fixture();
  pane.state_change_seq = 1;
  remark.update(pane);
  assert.equal(pane.tokens.remark_lamp_idle, "○ repo");
  pane.agent_status = "working";
  pane.state_change_seq = 2;
  remark.update(pane);
  pane.terminal_id = "replacement";
  pane.agent_status = "idle";
  pane.state_change_seq = 3;
  remark.update(pane);
  assert.equal(pane.tokens.remark_lamp_idle, "○ repo");
});

test("viewing during work does not acknowledge the completion that follows", () => {
  const { pane } = fixture("working");
  pane.state_change_seq = 10;
  remark.update(pane, false);
  assert.equal(pane.tokens.remark_seen, undefined);
  pane.agent_status = "idle";
  pane.state_change_seq = 11;
  remark.update(pane);
  assert.equal(pane.tokens.remark_lamp_unread, "● repo");
});

test("directories and note defaults use actual names", () => {
  for (const [cwd, name] of [["C:\\work\\repo\\", "repo"], ["/work/repo/", "repo"],
    ["/", "/"], ["", ""], ["\\\\server\\share\\repo", "repo"]])
    assert.equal(directory(cwd), name);
  const pane = { label: "Note", tokens: { summary: "Summary" }, terminal_title_stripped: "Title" };
  assert.equal(remark.initialNote(pane), "Note");
  delete pane.label;
  assert.equal(remark.initialNote(pane), "Summary");
  delete pane.tokens;
  assert.equal(remark.initialNote(pane), "Title");
});

test("a directory change pairs the new folder with its own branch, not the old one", () => {
  const { pane } = fixture();
  // The caller's snapshot still points at the old directory, which is exactly
  // the state a `cd` plus a restarted agent produces before Herdr republishes.
  pane.cwd = "C:\\work\\old-repo";
  herdr.branch = cwd => cwd === "C:\\work\\new-repo" ? "feat/new" : "old-branch";
  const cli = herdr.cli;
  herdr.cli = args => {
    // By the time update() reads the pane, the directory has already moved.
    if (args[1] === "get") return { pane: { ...pane, cwd: "C:\\work\\new-repo" } };
    return cli(args);
  };
  remark.update(pane, false);
  // The lamp carried the new folder while branch still came from the old cwd.
  assert.equal(pane.tokens.remark_lamp_idle, "○ new-repo");
  assert.equal(pane.tokens.remark_branch, "feat/new");
});

test("a batch resolves each branch from that pane's current directory", () => {
  const stale = { pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1", cwd: "C:\\work\\repo",
    agent: "codex", agent_status: "idle", tokens: {} };
  const moved = { pane_id: "w1:p2", tab_id: "w1:t1", workspace_id: "w1", cwd: "C:\\work\\repo",
    agent: "codex", agent_status: "idle", tokens: {} };
  const cwds = [];
  herdr.branch = cwd => { cwds.push(cwd); return cwd === "C:\\work\\other" ? "elsewhere" : "main"; };
  herdr.cli = args => {
    if (args[0] === "tab") return { tabs: [{ tab_id: "w1:t1", label: "Build" }] };
    if (args[1] === "get") {
      const pane = args[2] === "w1:p2" ? { ...moved, cwd: "C:\\work\\other" } : stale;
      return { pane };
    }
    if (args[1] === "report-metadata") applyMetadata(args, args[2] === "w1:p1" ? stale : moved);
    return {};
  };
  remark.refresh([stale, moved]);
  // Each branch comes from that pane's current directory.
  assert.deepEqual(cwds, ["C:\\work\\repo", "C:\\work\\other"]);
  assert.equal(stale.tokens.remark_branch, "main");
  assert.equal(moved.tokens.remark_branch, "elsewhere");
});

test("an exited agent clears its stale lamp, branch and note", () => {
  const { pane, calls } = fixture("working");
  pane.tokens = { remark_lamp_working: "● repo", remark_branch: "main", remark_note: "note", remark_tab: "Build" };
  const bare = { ...pane, agent: undefined, agent_status: "unknown", tokens: pane.tokens };
  herdr.branch = () => assert.fail("an exited agent must not query Git");
  herdr.cli = args => {
    calls.push(args);
    if (args[0] === "tab") return { tabs: [{ tab_id: "w1:t1", label: "Build" }] };
    if (args[1] === "get") return { pane: bare };
    if (args[1] === "report-metadata") applyMetadata(args, bare);
    return {};
  };
  process.env.HERDR_PLUGIN_EVENT = "pane.exited";
  process.env.HERDR_PLUGIN_EVENT_JSON = JSON.stringify({ pane_id: pane.pane_id });
  remark.main("event");
  assert.deepEqual(bare.tokens, {});
  // Exit must not query a tab or Git for a pane it is only clearing.
  assert.equal(calls.some(args => args[0] === "tab"), false);
});

test("an exit also drops a stale unread mark so the next agent is not born unread", () => {
  // Herdr clears `agent_status` on exit but keeps reported tokens. If the unread
  // flag survived, whatever agent starts in this pane next would inherit it and
  // show a blue unread lamp the user never set.
  const { pane, calls } = fixture("idle");
  const tokens = { remark_lamp_unread: "● repo", remark_unread: "1", remark_note: "note" };
  const bare = { ...pane, agent: undefined, agent_status: "unknown", tokens };
  herdr.cli = args => {
    calls.push(args);
    if (args[1] === "get") return { pane: bare };
    if (args[1] === "report-metadata") applyMetadata(args, bare);
    return {};
  };
  process.env.HERDR_PLUGIN_EVENT = "pane.exited";
  process.env.HERDR_PLUGIN_EVENT_JSON = JSON.stringify({ pane_id: pane.pane_id });
  remark.main("event");
  assert.equal(bare.tokens.remark_unread, undefined);
  assert.deepEqual(bare.tokens, {});
});

test("a closed pane during a batch refresh does not abort the remaining panes", () => {
  const panes = ["w1:p1", "w1:p2", "w1:p3"].map(id => ({ pane_id: id, tab_id: "w1:t1", workspace_id: "w1",
    cwd: "C:\\work\\repo", agent: "codex", agent_status: "idle", tokens: {} }));
  const seen = [];
  herdr.branch = () => "main";
  herdr.cli = args => {
    if (args[0] === "tab") return { tabs: [{ tab_id: "w1:t1", label: "Build" }] };
    if (args[1] === "get") {
      if (args[2] === "w1:p2") throw Object.assign(Error("no such pane"), { code: "pane_not_found" });
      seen.push(args[2]);
      return { pane: panes.find(p => p.pane_id === args[2]) };
    }
    return {};
  };
  remark.refresh(panes);
  // p2 is skipped; p3 still refreshes instead of the whole batch dying.
  assert.deepEqual(seen, ["w1:p1", "w1:p3"]);
});

test("init reports failed pane reads after refreshing the remaining rows", () => {
  const { pane } = fixture();
  const cli = herdr.cli;
  herdr.cli = args => {
    if (args[0] === "agent") return { agents: [{ pane_id: "bad" }, pane] };
    if (args[1] === "get" && args[2] === "bad") throw Error("API unavailable");
    return cli(args);
  };
  assert.throws(() => remark.main("init"), /bad: API unavailable/);
  assert.equal(pane.tokens.remark_tab, "Build");
});

test("init fails when every pane read fails", () => {
  herdr.cli = args => {
    if (args[0] === "agent") return { agents: [{ pane_id: "p1" }] };
    throw Error("API unavailable");
  };
  assert.throws(() => remark.main("init"), /p1: API unavailable/);
});

test("reload waits for Herdr's plugin command and propagates its failure", async () => {
  for (const status of ["succeeded", "failed"]) {
    const calls = [];
    herdr.cli = args => {
      calls.push(args);
      if (args[1] === "action") return { log: { log_id: "init-1", status: "running" } };
      return { logs: [{ log_id: "another", status: "succeeded" },
        { log_id: "init-1", status, stderr: status === "failed" ? "pane refresh failed" : "" }] };
    };
    if (status === "failed") await assert.rejects(remark.main("reload"), /pane refresh failed/);
    else await remark.main("reload");
    assert.deepEqual(calls[0], ["plugin", "action", "invoke", "refresh", "--plugin", herdr.ID]);
    assert.equal(calls.length, 2);
  }
});

test("toggle renders the accepted unread state after acknowledging completion", () => {
  const { pane, calls } = fixture("done");
  pane.state_change_seq = 1;
  assert.equal(remark.toggle(pane), false);
  assert.ok(calls.every(args => args[1] !== "focus"));
  // Read the action target and then the accepted state after writing the flag.
  assert.equal(calls.filter(args => args[1] === "get").length, 3);
  assert.equal(pane.agent_status, "done");
  assert.equal(pane.tokens.remark_lamp_idle, "○ repo");
});

test("a background refresh cannot invalidate a delayed manual unread write", () => {
  const { pane, calls } = fixture();
  const cli = herdr.cli;
  let interleaved = false;
  herdr.cli = args => {
    if (!interleaved && args.some(arg => arg.startsWith("remark_unread="))) {
      interleaved = true;
      remark.update(structuredClone(pane));
    }
    return cli(args);
  };
  assert.equal(remark.toggle(structuredClone(pane)), true);
  assert.ok(pane.tokens.remark_unread);
  assert.equal(pane.tokens.remark_lamp_unread, "● repo");
  assert.ok(calls.some(args => args.includes(READ_SOURCE)));
});

test("a newer lamp tick does not invalidate text refreshed while Git was running", () => {
  const { pane } = fixture("working");
  pane.label = "Current note";
  herdr.branch = () => {
    herdr.cli(["pane", "report-metadata", pane.pane_id, "--source", LAMP_SOURCE,
      "--seq", String(herdr.sequence()), "--clear-token", "remark_lamp_working",
      "--token", "remark_lamp_working_blink=● repo"]);
    return "feature/new";
  };
  remark.update(pane);
  assert.equal(pane.tokens.remark_branch, "feature/new");
  assert.equal(pane.tokens.remark_note, "Current note");
  assert.equal(pane.tokens.remark_lamp_working_blink, "● repo");
  assert.equal(pane.tokens.remark_lamp_working, undefined);
});

test("a batch cannot restore an old Tab name after a rename during Git lookup", () => {
  const { pane } = fixture();
  const cli = herdr.cli;
  let renamed = false;
  herdr.cli = args => args[0] === "tab"
    ? { tabs: [{ tab_id: pane.tab_id, label: renamed ? "New" : "Old" }] } : cli(args);
  herdr.branch = () => {
    herdr.branch = () => "new-branch";
    renamed = true;
    remark.update(structuredClone(pane));
    return "old-branch";
  };
  remark.refresh([structuredClone(pane)]);
  assert.equal(pane.tokens.remark_tab, "New");
  assert.equal(pane.tokens.remark_branch, "new-branch");
});

test("an ordinary state event reads the pane once and refreshes all display fields", () => {
  const { pane, calls } = fixture("blocked");
  pane.cwd = "/fresh/project";
  pane.label = "Current note";
  herdr.branch = cwd => { assert.equal(cwd, pane.cwd); return "current-branch"; };
  process.env.HERDR_PLUGIN_EVENT = "pane.agent_status_changed";
  process.env.HERDR_PLUGIN_EVENT_JSON = JSON.stringify({ pane_id: pane.pane_id, cwd: "/old" });
  remark.main("event");
  assert.equal(calls.filter(args => args[1] === "get").length, 1);
  assert.equal(pane.tokens.remark_lamp_blocked, "● project");
  assert.equal(pane.tokens.remark_tab, "Build");
  assert.equal(pane.tokens.remark_branch, "current-branch");
  assert.equal(pane.tokens.remark_note, "Current note");
});

test("viewing one completion does not mark the next completion as read", () => {
  const { pane } = fixture("done");
  pane.state_change_seq = 10;
  remark.update(pane, false);
  assert.equal(pane.tokens.remark_seen, "10");
  assert.equal(pane.tokens.remark_lamp_idle, "○ repo");
  pane.state_change_seq = 12;
  remark.update(pane);
  assert.equal(pane.tokens.remark_lamp_unread, "● repo");
});

test("batch refresh after detection recovery preserves read state in unrelated agents", () => {
  const { pane } = fixture("done");
  pane.state_change_seq = 10;
  remark.update(pane, false);
  const other = { ...structuredClone(pane), pane_id: "w1:p2", terminal_id: "other-term" };
  other.tokens = { remark_activity: JSON.stringify([other.terminal_id, "20", "idle", "20"]),
    remark_seen: "20", remark_lamp_idle: "○ repo" };
  other.agent_status = "idle";
  other.state_change_seq = 20;
  const panes = [pane, other];
  const cli = herdr.cli;
  herdr.cli = args => {
    if (args[0] === "agent") return { agents: structuredClone(panes) };
    if (args[1] === "get") return { pane: structuredClone(panes.find(item => item.pane_id === args[2])) };
    if (args[1] === "report-metadata") {
      applyMetadata(args, panes.find(item => item.pane_id === args[2]));
      return {};
    }
    return cli(args);
  };
  pane.agent_status = "unknown";
  pane.state_change_seq = 11;
  remark.main("init");
  // A note/focus action during detection recovery must not erase prior reads.
  remark.update(pane, false);
  pane.agent_status = "done";
  pane.state_change_seq = 12;
  remark.main("init");
  remark.main("init");
  assert.equal(pane.tokens.remark_seen, "10");
  for (const item of panes) {
    assert.equal(item.tokens.remark_lamp_idle, "○ repo");
    assert.equal(item.tokens.remark_lamp_unread, undefined);
  }
  for (const [status, seq] of [["working", 13], ["unknown", 14], ["idle", 15]]) {
    pane.agent_status = status;
    pane.state_change_seq = seq;
    remark.main("init");
  }
  assert.equal(pane.tokens.remark_lamp_unread, "● repo", "the agent that worked has a new unread completion");
  assert.equal(other.tokens.remark_lamp_idle, "○ repo");
  assert.equal(other.tokens.remark_seen, "20");
  assert.equal(other.tokens.remark_lamp_unread, undefined);
});
