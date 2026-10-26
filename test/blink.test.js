"use strict";
const { test, beforeEach, afterEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const blink = require("../src/blink");
const settings = require("../src/settings");
const socket = require("../src/socket");
const wheel = require("../src/wheel");
beforeEach(() => { wheel.start = () => ({ close() {} }); });
const { clean, directory } = require("../src/text");
const herdr = require("../src/herdr");
const remark = require("../src/remark");
const { LAMP_SOURCE, READ_SOURCE, lampTokens } = require("../src/tokens");
const net = require("node:net");

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "remark-test-"));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const originals = { load: settings.load, request: socket.request, subscribe: socket.subscribe,
  update: remark.update, start: blink.start };
afterEach(() => {
  settings.load = originals.load;
  socket.request = originals.request;
  socket.subscribe = originals.subscribe;
  remark.update = originals.update;
  blink.start = originals.start;
});
const env = () => ({ HERDR_PLUGIN_STATE_DIR: fs.mkdtempSync(path.join(scratch, "state-")),
  HERDR_PLUGIN_CONFIG_DIR: fs.mkdtempSync(path.join(scratch, "conf-")),
  HERDR_SOCKET_PATH: "herdr.sock" });

test("clean strips escape sequences and bounds the width", () => {
  assert.equal(clean("  hello\n\x1b[31m世界\x1b[0m  "), "hello 世界");
  assert.equal(clean("\x1b]0;window title\x07hello"), "hello");
  assert.equal(Array.from(clean("😀".repeat(100))).length, 80);
});

test("directory understands both Windows and POSIX paths", () => {
  assert.equal(directory("C:\\work\\repo"), "repo");
  assert.equal(directory("/home/me/repo"), "repo");
  assert.equal(directory("C:\\"), "C:\\");
  // An unknown cwd must not render as a bare filesystem root.
  assert.equal(directory(""), "");
});

test("blink defaults to on at 800ms and survives a broken config file", () => {
  const e = env();
  assert.deepEqual(settings.load(e), { blink: true, blinkIntervalMs: 800, wheelRead: true });
  fs.writeFileSync(settings.filePath(e), "{ not json");
  assert.deepEqual(settings.load(e), { blink: true, blinkIntervalMs: 800, wheelRead: true });
  fs.writeFileSync(settings.filePath(e), JSON.stringify({ blink: false, blink_interval_ms: 250 }));
  assert.deepEqual(settings.load(e), { blink: false, blinkIntervalMs: 250, wheelRead: true });
});

test("UTF-8 BOM settings written by Windows PowerShell retain the configured options", () => {
  const e = env();
  fs.writeFileSync(settings.filePath(e), '\ufeff{"blink":false,"blink_interval_ms":400,"wheel_read":false}');
  assert.deepEqual(settings.load(e), { blink: false, blinkIntervalMs: 400, wheelRead: false });
});

test("an out-of-range interval is clamped rather than accepted", () => {
  const e = env();
  for (const [asked, expected] of [[1, settings.MIN_INTERVAL_MS], [999999, settings.MAX_INTERVAL_MS],
    ["abc", settings.DEFAULTS.blinkIntervalMs], [-5, settings.DEFAULTS.blinkIntervalMs]]) {
    fs.writeFileSync(settings.filePath(e), JSON.stringify({ blink_interval_ms: asked }));
    assert.equal(settings.load(e).blinkIntervalMs, expected, `interval ${asked}`);
  }
});

test("a socket path becomes a Windows named pipe only on Windows", () => {
  assert.equal(socket.pipePath("herdr.sock"), process.platform === "win32" ? "\\\\.\\pipe\\herdr.sock" : "herdr.sock");
  assert.equal(socket.pipePath("\\\\.\\pipe\\already"), "\\\\.\\pipe\\already");
  assert.equal(socket.pipePath(""), null);
});

test("a request without a socket path fails instead of hanging", async () => {
  await assert.rejects(() => socket.request("ping", {}, { socketPath: "" }), /HERDR_SOCKET_PATH/);
});

test("the lamp alternates between one bright and one dim token", () => {
  const agent = { pane_id: "w1:p1", cwd: "C:\\work\\repo", agent: "codex", agent_status: "working" };
  for (const on of [true, false]) {
    const tokens = lampTokens(agent, on);
    assert.deepEqual(Object.entries(tokens).filter(([, value]) => value !== null),
      [[on ? "remark_lamp_working" : "remark_lamp_working_blink", "● repo"]]);
  }
});

test("only one daemon may hold the lock, and a dead owner is taken over", async () => {
  const e = env();
  assert.equal(blink.running(e), false);
  assert.equal(await blink.claim(e), true);
  assert.equal(blink.lockOwner(e), process.pid);
  // A second claimant sees the live owner and steps aside.
  const mine = process.pid;
  fs.writeFileSync(blink.lockFile(e), String(mine));
  assert.equal(blink.running(e), true);
  assert.equal(await blink.claim(e), false);
  // A lock left behind by a process that no longer exists is reclaimed.
  blink.release(e);
  fs.writeFileSync(blink.lockFile(e), "999999999");
  assert.equal(blink.running(e), false);
  assert.equal(await blink.claim(e), true);
  blink.release(e);
  assert.equal(blink.running(e), false);
});

test("sessions sharing plugin storage elect independent monitors and reload only their own", async () => {
  const first = env();
  const second = { ...first, HERDR_SOCKET_PATH: "another-session.sock" };
  try {
    assert.equal(await blink.claim(first), true);
    assert.equal(await blink.claim(second), true);
    assert.notEqual(blink.lockFile(first), blink.lockFile(second));
    blink.requestReload(first);
    assert.ok(fs.existsSync(path.join(blink.stateDir(first), "blink.reload")));
    assert.equal(fs.existsSync(path.join(blink.stateDir(second), "blink.reload")), false);
  } finally { blink.release(first); blink.release(second); }
});

test("reload hands an older shared monitor over to the current session-aware implementation", async () => {
  const e = env();
  const monitorLock = require("../src/monitor-lock");
  const legacy = path.join(e.HERDR_PLUGIN_STATE_DIR, "blink.lock");
  assert.equal(await monitorLock.claim(legacy), true);
  try {
    blink.requestReload(e);
    assert.ok(fs.readFileSync(path.join(e.HERDR_PLUGIN_STATE_DIR, "blink.reload"), "utf8"));
  } finally { monitorLock.release(legacy); }
});

test("release leaves another process's lock alone", () => {
  const e = env();
  fs.mkdirSync(path.dirname(blink.lockFile(e)), { recursive: true });
  fs.writeFileSync(blink.lockFile(e), "424242");
  blink.release(e);
  assert.equal(fs.readFileSync(blink.lockFile(e), "utf8"), "424242");
});

test("a run blinks only working agents, then clears its twin and exits", async () => {
  const e = env();
  settings.load = () => ({ blink: true, blinkIntervalMs: 1 });
  const writes = [];
  let listings = 0;
  socket.request = async (method, params) => {
    if (method === "agent.list") {
      listings++;
      // Working on the first pass, finished afterwards, so the loop can exit.
      return { agents: listings === 1
        ? [{ pane_id: "w1:p1", cwd: "C:\\work\\repo", agent: "codex", agent_status: "working" },
           { pane_id: "w1:p2", cwd: "C:\\work\\other", agent: "codex", agent_status: "idle" }]
        : [{ pane_id: "w1:p1", cwd: "C:\\work\\repo", agent: "codex", agent_status: "idle" }] };
    }
    writes.push(params);
    return {};
  };
  await blink.run(e);
  assert.deepEqual(writes.map(write => write.pane_id), ["w1:p1", "w1:p1"]);
  // The idle pane is never touched.
  assert.ok(writes.every(write => write.pane_id !== "w1:p2"));
  // The first tick dims the lamp; the final write clears the dim twin.
  assert.equal(writes[0].tokens.remark_lamp_working, null);
  assert.equal(writes[0].tokens.remark_lamp_working_blink, "● repo");
  assert.equal(writes[1].tokens.remark_lamp_working_blink, null);
  assert.equal(writes[1].tokens.remark_lamp_working, null);
  assert.equal(writes[1].tokens.remark_lamp_idle, "○ repo");
  assert.equal(blink.running(e), false);
});

test("blinking disabled starts no animation and leaves working lamps alone", async () => {
  const e = env();
  fs.writeFileSync(settings.filePath(e), JSON.stringify({ blink: false }));
  assert.equal(blink.start(e), false);
  settings.load = () => ({ blink: false, blinkIntervalMs: 1 });
  socket.request = async method => {
    assert.equal(method, "agent.list");
    return { agents: [{ pane_id: "p1", agent: "codex", agent_status: "working" }] };
  };
  await blink.run(e);
  assert.equal(fs.existsSync(path.join(blink.stateDir(e), "blink-error.log")), false);
});

test("turning blinking off mid-run stops the daemon without a restart", async () => {
  const e = env();
  let tick = 0;
  // The file is re-read every tick, so the second tick already sees blink:false.
  settings.load = () => ({ blink: ++tick < 2, blinkIntervalMs: 1 });
  socket.request = async (method, params) => {
    if (method === "agent.list")
      return { agents: [{ pane_id: "w1:p1", cwd: "C:\\work\\repo", agent: "codex", agent_status: "working" }] };
    writes.push(params);
    return {};
  };
  const writes = [];
  await blink.run(e);
  // One blink tick, then the cleanup write that clears the dim twin.
  assert.deepEqual(writes.map(write => write.pane_id), ["w1:p1", "w1:p1"]);
  assert.equal(writes.at(-1).tokens.remark_lamp_working, "● repo");
  assert.equal(writes.at(-1).tokens.remark_lamp_working_blink, null);
  assert.equal(blink.running(e), false);
});

test("a socket failure is recorded instead of crashing the daemon", async () => {
  const e = env();
  settings.load = () => ({ blink: true, blinkIntervalMs: 1 });
  socket.request = async () => { throw new Error("server gone"); };
  await blink.run(e);
  assert.equal(blink.running(e), false);
  assert.match(fs.readFileSync(path.join(blink.stateDir(e), "blink-error.log"), "utf8"), /server gone/);
});

test("a transient poll failure keeps monitoring when the same server still responds", async () => {
  const e = env();
  settings.load = () => ({ blink: true, blinkIntervalMs: 1 });
  let polls = 0, pings = 0, recoveredPaint = false;
  socket.request = async (method, params) => {
    if (method === "ping") { pings++; return {}; }
    if (method === "agent.list") {
      if (++polls === 2) throw Error("transient poll failure");
      return { agents: polls <= 3 ? [{ pane_id: "p1", agent: "custom", agent_status: "working" }] : [] };
    }
    if (polls === 3 && (params.tokens.remark_lamp_working || params.tokens.remark_lamp_working_blink)) recoveredPaint = true;
    return {};
  };
  await blink.run(e);
  assert.equal(pings, 1);
  assert.equal(recoveredPaint, true);
  assert.equal(blink.running(e), false);
});

test("cleanup after a transient failure reads the current status before restoring a lamp", async () => {
  const e = env();
  settings.load = () => ({ blink: true, blinkIntervalMs: 1 });
  let tick = 0;
  socket.request = async (method, params) => {
    if (method === "agent.list") {
      // One blink tick, then the server goes away while the agent still works.
      if (++tick === 2) throw new Error("server temporarily unavailable");
      return { agents: [{ pane_id: "w1:p1", cwd: "C:\\work\\repo", agent: "codex", agent_status: tick === 1 ? "working" : "idle" }] };
    }
    writes.push(params);
    return {};
  };
  const writes = [];
  await blink.run(e);
  const last = writes[writes.length - 1];
  // The bright lamp is restored, so a crash cannot leave a permanently dim row.
  assert.equal(last.tokens.remark_lamp_working, null);
  assert.equal(last.tokens.remark_lamp_idle, "○ repo");
  assert.equal(last.tokens.remark_lamp_working_blink, null);
});

test("an agent that exits loses both working tokens", async () => {
  const e = env();
  settings.load = () => ({ blink: true, blinkIntervalMs: 1 });
  let listings = 0;
  socket.request = async (method, params) => {
    if (method === "agent.list") {
      // Working once, then idle: the hook has already set the real lamp.
      return { agents: ++listings === 1
        ? [{ pane_id: "w1:p1", cwd: "C:\\work\\repo", agent: "codex", agent_status: "working" }]
        : [] };
    }
    writes.push(params);
    return {};
  };
  const writes = [];
  await blink.run(e);
  const last = writes[writes.length - 1];
  assert.ok(Object.values(last.tokens).every(value => value === null));
});

test("start does nothing without a socket to draw on", () => {
  const e = env();
  e.HERDR_SOCKET_PATH = "";
  assert.equal(blink.start(e), false);
  assert.equal(blink.start({ HERDR_SOCKET_PATH: "test" }), false);
});

test("non-object JSON configuration falls back to defaults", () => {
  const e = env();
  for (const value of [null, [], true, 12, "text"]) {
    fs.writeFileSync(settings.filePath(e), JSON.stringify(value));
    assert.deepEqual(settings.load(e), settings.DEFAULTS);
  }
});

test("a late bright tick cannot overwrite a newer idle refresh", async () => {
  const e = env();
  settings.load = () => ({ blink: true, blinkIntervalMs: 1 });
  const agent = { pane_id: "p1", agent: "codex", cwd: "/repo", agent_status: "working" };
  const tokens = {};
  let listings = 0, watermark = 0, interleaved = false;
  const apply = (seq, changes) => {
    if (seq <= watermark) return;
    watermark = seq;
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) delete tokens[key]; else tokens[key] = value;
    }
  };
  socket.request = async (method, params) => {
    if (method === "agent.list") { listings++; return { agents: [structuredClone(agent)] }; }
    assert.equal(params.source, LAMP_SOURCE);
    if (listings === 2 && !interleaved) {
      interleaved = true;
      agent.agent_status = "idle";
      apply(herdr.sequence(), lampTokens(agent));
    }
    apply(params.seq, params.tokens);
    return {};
  };
  await blink.run(e);
  assert.equal(interleaved, true);
  assert.deepEqual(tokens, { remark_lamp_idle: "○ repo" });
});

test("partial scrolling in either direction counts, output growth and resize do not", () => {
  const before = { offset_from_bottom: 20, max_offset_from_bottom: 100, viewport_rows: 30 };
  assert.equal(blink.scrolled(before, { ...before, offset_from_bottom: 23 }), true);
  assert.equal(blink.scrolled(before, { ...before, offset_from_bottom: 17 }), true);
  assert.equal(blink.scrolled(before, { ...before, offset_from_bottom: 22, max_offset_from_bottom: 102 }), false);
  assert.equal(blink.scrolled(before, { ...before, offset_from_bottom: 22, viewport_rows: 28 }), false);
  assert.equal(blink.scrolled({ ...before, offset_from_bottom: 0 }, { ...before, offset_from_bottom: 0, max_offset_from_bottom: 102 }), false);
  assert.equal(blink.scrolled(undefined, before), false);
});

test("scroll-to-read uses the existing monitor even with blinking off and coalesces a scroll burst", async () => {
  settings.load = () => ({ blink: false, blinkIntervalMs: 1 });
  const e = env();
  const agent = { pane_id: "p1", terminal_id: "term1", agent: "codex", agent_status: "idle",
    state_change_seq: 1, tokens: { remark_unread: "1" } };
  const writes = [];
  let refreshed = 0, closed = 0;
  remark.update = pane => { assert.equal(pane.pane_id, "p1"); refreshed++; };
  socket.request = async (method, params) => {
    if (method === "agent.list") return { agents: [structuredClone(agent)] };
    if (method === "pane.list") return { panes: [{ pane_id: "p1",
      scroll: { offset_from_bottom: 20, max_offset_from_bottom: 100, viewport_rows: 30 } }] };
    assert.equal(method, "pane.report_metadata");
    writes.push(params);
    delete agent.tokens.remark_unread;
    return {};
  };
  socket.subscribe = (subscriptions, onEvent) => {
    assert.deepEqual(subscriptions, [{ type: "pane.scroll_changed", pane_id: "p1" }]);
    return { closed: false, close: () => { closed++; }, ready: Promise.resolve().then(() => {
      const emit = (offset, max) => onEvent({ event: "pane.scroll_changed", data: { pane_id: "p1",
        scroll: { offset_from_bottom: offset, max_offset_from_bottom: max, viewport_rows: 30 } } });
      emit(22, 102); // New output alone must not trigger a read.
      assert.equal(writes.length, 0);
      for (let offset = 23; offset < 33; offset++) emit(offset, 102);
    }) };
  };
  await blink.run(e);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].source, READ_SOURCE);
  assert.equal(writes[0].tokens.remark_unread, null);
  assert.equal(refreshed, 1);
  assert.equal(closed, 1);
  assert.equal(blink.running(e), false);
  assert.equal(fs.existsSync(path.join(blink.stateDir(e), "blink-error.log")), false);
});

test("a delayed scroll event does not acknowledge a newer completion", async () => {
  const watched = { pane_id: "p1", terminal_id: "term1", agent: "codex", agent_status: "done", state_change_seq: 1 };
  socket.request = async method => {
    assert.equal(method, "agent.list");
    return { agents: [{ ...watched, state_change_seq: 2 }] };
  };
  remark.update = () => assert.fail("a newer turn must not be acknowledged");
  await blink.acknowledge(watched, herdr.sequence(), env());
});

test("a newer completion_seq is checked again immediately before acknowledgement", async () => {
  const watched = { pane_id: "p1", terminal_id: "term1", agent_status: "done", state_change_seq: 10, completion_seq: 8 };
  socket.request = async method => {
    assert.equal(method, "agent.list");
    return { agents: [{ ...watched, completion_seq: 9 }] };
  };
  remark.update = () => assert.fail("must preserve the newer completion");
  await blink.acknowledge(watched, herdr.sequence(), env());
});

test("wheel input shares the read queue and its helper stops when unread clears", async () => {
  settings.load = () => ({ blink: false, blinkIntervalMs: 1, wheelRead: true });
  const e = env();
  const agent = { pane_id: "p1", terminal_id: "term1", agent_status: "idle", state_change_seq: 1,
    tokens: { remark_unread: "100" } };
  let starts = 0, closes = 0, writes = 0, refreshes = 0;
  wheel.start = (getWatched, read) => {
    starts++;
    const snapshot = getWatched().get("p1");
    read(snapshot, herdr.sequence());
    read(snapshot, herdr.sequence());
    return { close() { closes++; } };
  };
  socket.request = async (method, params) => {
    if (method === "agent.list") return { agents: [structuredClone(agent)] };
    if (method === "pane.list") return { panes: [] };
    assert.equal(params.source, READ_SOURCE);
    writes++;
    agent.tokens = {};
    return {};
  };
  socket.subscribe = () => ({ closed: false, ready: Promise.resolve(), close() {} });
  remark.update = () => { refreshes++; };
  await blink.run(e);
  assert.deepEqual({ starts, closes, writes, refreshes }, { starts: 1, closes: 1, writes: 1, refreshes: 1 });
});

test("wheel_read false leaves the public scroll subscription available without a native helper", async () => {
  const e = env();
  fs.writeFileSync(settings.filePath(e), JSON.stringify({ wheel_read: false }));
  assert.equal(settings.load(e).wheelRead, false);
  settings.load = () => ({ blink: false, blinkIntervalMs: 1, wheelRead: false });
  let subscriptions = 0;
  wheel.start = () => assert.fail("disabled native helper must not start");
  socket.request = async method => method === "agent.list" ? { agents: subscriptions ? [] : [
    { pane_id: "p1", agent_status: "idle", tokens: { remark_unread: "1" } },
  ] } : { panes: [] };
  socket.subscribe = () => { subscriptions++; return { closed: false, ready: Promise.resolve(), close() {} }; };
  await blink.run(e);
  assert.equal(subscriptions, 1);
});

test("a failed wheel helper is restarted with a delay while unread panes remain", async t => {
  const e = env();
  settings.load = () => ({ blink: false, blinkIntervalMs: 1, wheelRead: true });
  let starts = 0, ticks = 0;
  t.mock.method(Date, "now", () => ticks * 2000);
  const agent = { pane_id: "p1", agent_status: "idle", tokens: { remark_unread: "1" } };
  socket.request = async method => {
    if (method !== "agent.list") return { panes: [] };
    if (++ticks === 3) assert.equal(starts, 1, "failed helpers must not restart every tick");
    return { agents: ticks <= 4 ? [agent] : [] };
  };
  socket.subscribe = () => ({ ready: Promise.resolve(), closed: false, close() {} });
  wheel.start = () => {
    const failed = ++starts === 1;
    return { get closed() { return failed; }, close() {} };
  };
  await blink.run(e);
  assert.equal(starts, 2);
});

test("scrolling after an automatic completion but before monitor startup is acknowledged", async () => {
  const e = env();
  settings.load = () => ({ blink: false, blinkIntervalMs: 1, wheelRead: false });
  const initial = { offset_from_bottom: 0, max_offset_from_bottom: 100, viewport_rows: 30 };
  const { activityTokens } = require("../src/tokens");
  const agent = { pane_id: "p1", terminal_id: "term1", agent: "codex", agent_status: "working",
    state_change_seq: 1, tokens: {}, scroll: initial };
  Object.assign(agent.tokens, activityTokens(agent));
  agent.agent_status = "done";
  agent.state_change_seq = 2;
  agent.completion_seq = 2;
  Object.assign(agent.tokens, activityTokens(agent));
  let writes = 0, ticks = 0;
  remark.update = () => {};
  socket.request = async (method, params) => {
    if (method === "agent.list") return { agents: ++ticks < 8 ? [structuredClone(agent)] : [] };
    if (method === "pane.list") return { panes: [{ pane_id: "p1", scroll: { ...initial, offset_from_bottom: 3 } }] };
    assert.equal(params.source, READ_SOURCE);
    writes++;
    agent.tokens.remark_seen = "2";
    return {};
  };
  socket.subscribe = () => ({ ready: Promise.resolve(), closed: false, close() {} });
  await blink.run(e);
  assert.equal(writes, 1);
});

test("a completion baseline published after subscription setup is reconciled", async () => {
  const e = env();
  settings.load = () => ({ blink: false, blinkIntervalMs: 1, wheelRead: false });
  const initial = { offset_from_bottom: 0, max_offset_from_bottom: 100, viewport_rows: 30 };
  const { activityTokens } = require("../src/tokens");
  const agent = { pane_id: "p1", terminal_id: "term1", agent: "codex", agent_status: "working",
    state_change_seq: 1, tokens: {}, scroll: initial };
  Object.assign(agent.tokens, activityTokens(agent));
  agent.agent_status = "done";
  agent.state_change_seq = 2;
  agent.completion_seq = 2;
  let polls = 0, writes = 0;
  remark.update = () => {};
  socket.request = async (method, params) => {
    if (method === "agent.list") {
      if (++polls === 2) Object.assign(agent.tokens, activityTokens(agent));
      return { agents: polls < 8 ? [structuredClone(agent)] : [] };
    }
    if (method === "pane.list") return { panes: [{ pane_id: "p1", scroll: { ...initial, offset_from_bottom: 3 } }] };
    assert.equal(params.source, READ_SOURCE);
    writes++;
    agent.tokens.remark_seen = "2";
    return {};
  };
  socket.subscribe = () => ({ ready: Promise.resolve(), closed: false, close() {} });
  await blink.run(e);
  assert.equal(writes, 1);
});

test("a queued acknowledgement cannot clear a newer manual mark in the same round", async () => {
  const watched = { pane_id: "p1", terminal_id: "term1", agent: "codex", agent_status: "idle",
    state_change_seq: 1, tokens: { remark_unread: "100" } };
  socket.request = async method => {
    assert.equal(method, "agent.list");
    return { agents: [{ ...watched, tokens: { remark_unread: "200" } }] };
  };
  remark.update = () => assert.fail("the newer manual mark must remain unread");
  await blink.acknowledge(watched, herdr.sequence(), env());
});

test("the first scroll after a state transition uses a fresh generation", async () => {
  settings.load = () => ({ blink: false, blinkIntervalMs: 1 });
  const e = env();
  const agent = { pane_id: "p1", terminal_id: "term1", agent: "codex", agent_status: "idle",
    state_change_seq: 1, tokens: { remark_unread: "1" } };
  let reads = 0;
  const scroll = { offset_from_bottom: 0, max_offset_from_bottom: 100, viewport_rows: 30 };
  remark.update = () => {};
  socket.request = async (method, params) => {
    if (method === "agent.list") return { agents: [structuredClone(agent)] };
    if (method === "pane.list") return { panes: [{ pane_id: "p1", scroll }] };
    assert.equal(params.source, READ_SOURCE);
    assert.equal(params.tokens.remark_seen, "2");
    reads++;
    agent.tokens = { remark_seen: "2" };
    return {};
  };
  socket.subscribe = (_, onEvent) => ({ closed: false, close() {}, ready: Promise.resolve().then(() => {
    agent.agent_status = "done";
    agent.state_change_seq = 2;
    agent.completion_seq = 2;
    onEvent({ event: "pane.scroll_changed", data: { pane_id: "p1", scroll: { ...scroll, offset_from_bottom: 3 } } });
  }) });
  await blink.run(e);
  assert.equal(reads, 1);
});

test("a subscription failure retries without stopping another working lamp", async () => {
  settings.load = () => ({ blink: true, blinkIntervalMs: 1 });
  const e = env();
  let attempts = 0, paints = 0;
  const working = { pane_id: "w", agent: "codex", agent_status: "working" };
  const unread = { pane_id: "u", agent: "codex", agent_status: "idle", tokens: { remark_unread: "1" } };
  socket.request = async (method, params) => {
    if (method === "agent.list") return { agents: attempts < 2 ? [working, unread] : [] };
    if (method === "pane.list") return { panes: [] };
    if (params.tokens.remark_lamp_working || params.tokens.remark_lamp_working_blink) paints++;
    return {};
  };
  socket.subscribe = () => ({ closed: false, close() {},
    ready: ++attempts === 1 ? Promise.reject(Error("subscription unavailable")) : Promise.resolve() });
  await blink.run(e);
  assert.equal(attempts, 2);
  assert.equal(paints, 2);
});

test("a completion after the scroll snapshot is not acknowledged by that scroll", async () => {
  settings.load = () => ({ blink: false, blinkIntervalMs: 1 });
  const e = env();
  const agent = { pane_id: "p1", terminal_id: "term1", agent: "codex", agent_status: "done",
    state_change_seq: 1, completion_seq: 1, tokens: {} };
  const scroll = { offset_from_bottom: 0, max_offset_from_bottom: 100, viewport_rows: 30 };
  let lists = 0, reads = 0;
  socket.request = async method => {
    if (method === "agent.list") {
      const snapshot = structuredClone(agent);
      if (++lists === 2) agent.state_change_seq = 2;
      return { agents: lists < 4 ? [snapshot] : [] };
    }
    if (method === "pane.list") return { panes: [{ pane_id: "p1", scroll }] };
    reads++;
    return {};
  };
  socket.subscribe = (_, onEvent) => ({ closed: false, close() {}, ready: Promise.resolve().then(() => {
    onEvent({ event: "pane.scroll_changed", data: { pane_id: "p1", scroll: { ...scroll, offset_from_bottom: 3 } } });
  }) });
  await blink.run(e);
  assert.equal(reads, 0);
});

test("reload releases the existing monitor before starting its replacement", async () => {
  const e = env();
  settings.load = () => ({ blink: true, blinkIntervalMs: 1 });
  let starts = 0;
  blink.start = (actual, watchUnread) => {
    assert.equal(actual, e);
    assert.equal(watchUnread, true);
    assert.equal(blink.running(e), false);
    starts++;
  };
  socket.request = async method => {
    if (method === "agent.list") {
      blink.requestReload(e);
      return { agents: [{ pane_id: "p1", agent: "codex", agent_status: "working" }] };
    }
    return {};
  };
  await blink.run(e);
  assert.equal(starts, 1);
});

test("work arriving during the final idle poll wakes a replacement after release", async () => {
  const e = env();
  settings.load = () => ({ blink: true, blinkIntervalMs: 1 });
  let polls = 0, restarts = 0;
  socket.request = async method => {
    assert.equal(method, "agent.list");
    if (++polls === 2) {
      for (let i = 0; i < 5; i++)
        assert.equal(originals.start(e), false, "the old monitor still owns the lock");
    }
    return { agents: [] };
  };
  blink.start = actual => {
    assert.equal(actual, e);
    assert.equal(blink.running(e), false);
    restarts++;
  };
  await blink.run(e);
  assert.equal(polls, 2);
  assert.equal(restarts, 1);
});

test("a wake immediately before releasing the lock is handed off", async t => {
  const e = env();
  settings.load = () => ({ blink: true, blinkIntervalMs: 1 });
  socket.request = async () => ({ agents: [] });
  const lock = require("../src/monitor-lock");
  const release = lock.release;
  t.mock.method(lock, "release", file => {
    assert.equal(originals.start(e), false);
    release(file);
  });
  let restarts = 0;
  blink.start = () => {
    assert.equal(blink.running(e), false);
    restarts++;
  };
  await blink.run(e);
  assert.equal(restarts, 1);
});

test("an idle monitor without a wake request exits without spawning a replacement", async () => {
  const e = env();
  settings.load = () => ({ blink: true, blinkIntervalMs: 1 });
  let polls = 0, restarts = 0;
  socket.request = async method => {
    assert.equal(method, "agent.list");
    polls++;
    return { agents: [] };
  };
  blink.start = () => { restarts++; };
  await blink.run(e);
  assert.equal(polls, 2);
  assert.equal(restarts, 0);
});

test("scrolling immediately after marking unread is detected during monitor startup", async () => {
  settings.load = () => ({ blink: false, blinkIntervalMs: 1 });
  const e = env();
  const initial = { offset_from_bottom: 0, max_offset_from_bottom: 100, viewport_rows: 30 };
  const agent = { pane_id: "p1", terminal_id: "term1", agent: "codex", agent_status: "idle",
    state_change_seq: 1, tokens: { remark_unread: "1", remark_scroll: JSON.stringify(initial) } };
  let reads = 0;
  remark.update = () => {};
  socket.request = async (method, params) => {
    if (method === "agent.list") return { agents: [structuredClone(agent)] };
    if (method === "pane.list") return { panes: [{ pane_id: "p1", scroll: { ...initial, offset_from_bottom: 3 } }] };
    assert.equal(params.source, READ_SOURCE);
    reads++;
    agent.tokens = {};
    return {};
  };
  socket.subscribe = () => ({ ready: Promise.resolve(), close() {}, closed: false });
  await blink.run(e);
  assert.equal(reads, 1);
});

test("scrolling while the subscription is being established is not lost", async () => {
  settings.load = () => ({ blink: false, blinkIntervalMs: 1 });
  const e = env();
  const agent = { pane_id: "p1", terminal_id: "term1", agent: "codex", agent_status: "done",
    state_change_seq: 1, completion_seq: 1, tokens: {} };
  let offset = 0, lists = 0, reads = 0;
  remark.update = () => {};
  socket.request = async (method, params) => {
    if (method === "agent.list") return { agents: ++lists < 6 ? [structuredClone(agent)] : [] };
    if (method === "pane.list") return { panes: [{ pane_id: "p1", scroll: {
      offset_from_bottom: offset, max_offset_from_bottom: 100, viewport_rows: 30,
    } }] };
    assert.equal(params.source, READ_SOURCE);
    reads++;
    agent.tokens = { remark_seen: "1" };
    return {};
  };
  socket.subscribe = () => {
    // Herdr starts its subscription baseline here. Movement since pane.list
    // precedes that baseline and therefore produces no subscription event.
    offset = 3;
    return { ready: Promise.resolve(), close() {}, closed: false };
  };
  await blink.run(e);
  assert.equal(reads, 1);
});

// Use a local TCP transport to exercise actual stream framing and EOF on every
// CI platform; the production endpoint is still a named pipe / Unix socket.
async function transport(t, respond) {
  const connections = new Set();
  const server = net.createServer(client => {
    connections.add(client);
    client.on("close", () => connections.delete(client));
    client.once("data", data => respond(client, JSON.parse(data.toString().trim())));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const connect = net.connect;
  net.connect = () => connect({ host: "127.0.0.1", port: server.address().port });
  t.after(async () => {
    net.connect = connect;
    for (const client of connections) client.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  return { socketPath: "isolated-test", timeout: 100 };
}

test("socket EOF rejects an incomplete response instead of leaving a pending promise", { timeout: 1000 }, async t => {
  const options = await transport(t, client => client.end('{"result":'));
  await assert.rejects(socket.request("probe", {}, options), /响应不完整|已关闭/);
});

test("a fragmented complete socket response resolves before close", { timeout: 1000 }, async t => {
  const options = await transport(t, client => {
    client.write('{"result":');
    setImmediate(() => client.end('{"ok":true}}\n'));
  });
  assert.deepEqual(await socket.request("probe", {}, options), { ok: true });
});

test("subscription framing accepts fragmented and coalesced events and exposes disconnects", { timeout: 1000 }, async t => {
  const options = await transport(t, (client, request) => {
    assert.equal(request.method, "events.subscribe");
    client.write('{"result":{"type":"subscription_');
    setImmediate(() => client.end('started"}}\n{"event":"one","data":{}}\n{"event":"two","data":{}}\n'));
  });
  const events = [];
  const sub = socket.subscribe([{ type: "pane.scroll_changed", pane_id: "p1" }], event => events.push(event.event), options);
  t.after(() => sub.close());
  await sub.ready;
  // Let the EOF / close handlers run after the data callback.
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(events, ["one", "two"]);
  assert.equal(sub.closed, true);
});

function slowResponse(client, response) {
  client.write(" ");
  const stream = setInterval(() => client.write(" "), 10);
  const finish = setTimeout(() => { clearInterval(stream); client.end(response + "\n"); }, 500);
  client.on("close", () => { clearInterval(stream); clearTimeout(finish); });
}

test("socket request timeout bounds the whole response even while bytes keep arriving", { timeout: 2000 }, async t => {
  const options = await transport(t, client => slowResponse(client, '{"result":{"ok":true}}'));
  await assert.rejects(socket.request("probe", {}, options), /超时/);
});

test("subscription startup timeout cannot be postponed by a partial stream", { timeout: 2000 }, async t => {
  const options = await transport(t, client => slowResponse(client, '{"result":{"type":"subscription_started"}}'));
  const sub = socket.subscribe([], () => {}, options);
  t.after(() => sub.close());
  await assert.rejects(sub.ready, /超时/);
});

test("the monitor reconciles a native /new identity without a lifecycle event", { timeout: 5000 }, async () => {
  const { sessionKey } = require("../src/tokens");
  const e = env();
  settings.load = () => ({ blink: false, blinkIntervalMs: 1, wheelRead: false });
  const agent = { pane_id: "p1", terminal_id: "term", agent: "custom", agent_status: "idle", state_change_seq: 1,
    agent_session: { agent: "custom", kind: "id", value: "new" }, tokens: {
      remark_unread: "old", remark_session: sessionKey({ agent_session: { agent: "custom", kind: "id", value: "old" } }),
    } };
  let refreshed = 0;
  remark.update = pane => {
    assert.equal(pane.pane_id, agent.pane_id);
    refreshed++;
    agent.tokens = { remark_session: sessionKey(agent) };
  };
  socket.request = async method => {
    assert.equal(method, "agent.list");
    return { agents: [structuredClone(agent)] };
  };
  await blink.run(e);
  assert.equal(refreshed, 1);
  assert.equal(blink.running(e), false);
});

test("a scroll captured in the old session cannot read a newly reported session", { timeout: 5000 }, async () => {
  const { sessionKey } = require("../src/tokens");
  const e = env();
  settings.load = () => ({ blink: false, blinkIntervalMs: 1, wheelRead: false });
  const agent = { pane_id: "p1", terminal_id: "term", agent: "custom", agent_status: "idle", state_change_seq: 1,
    agent_session: { agent: "custom", kind: "id", value: "old" }, tokens: { remark_unread: "old" } };
  agent.tokens.remark_session = sessionKey(agent);
  const scroll = { offset_from_bottom: 0, max_offset_from_bottom: 100, viewport_rows: 30 };
  let refreshed = 0, reads = 0;
  socket.request = async method => {
    if (method === "agent.list") return { agents: [structuredClone(agent)] };
    if (method === "pane.list") return { panes: [{ pane_id: "p1", scroll }] };
    reads++;
    return {};
  };
  socket.subscribe = (_, onEvent) => ({ ready: Promise.resolve().then(() => {
    agent.agent_session.value = "new";
    onEvent({ event: "pane.scroll_changed", data: { pane_id: "p1", scroll: { ...scroll, offset_from_bottom: 3 } } });
  }), closed: false, close() {} });
  remark.update = () => { refreshed++; agent.tokens = { remark_session: sessionKey(agent) }; };
  await blink.run(e);
  assert.equal(reads, 0);
  assert.equal(refreshed, 1);
});

test("monitor repairs stale lamps from native state before exiting without acknowledging reads", { timeout: 5000 }, async () => {
  for (const [status, oldLamp, expected] of [["idle", "unread", "idle"], ["blocked", "idle", "blocked"],
    ["unknown", "unread", "unknown"], ["working", "idle", "working"]]) {
    const e = env();
    settings.load = () => ({ blink: false, blinkIntervalMs: 1, wheelRead: false });
    const agent = { pane_id: "p1", terminal_id: "term", agent: "custom", agent_status: status,
      state_change_seq: 2, tokens: { ["remark_lamp_" + oldLamp]: "old", remark_seen: "1", remark_round: "1" } };
    const writes = [];
    socket.request = async (method, params) => {
      if (method === "agent.list") return { agents: [structuredClone(agent)] };
      assert.equal(method, "pane.report_metadata");
      assert.equal(params.source, LAMP_SOURCE);
      writes.push(params);
      for (const [key, value] of Object.entries(params.tokens)) {
        if (value == null) delete agent.tokens[key]; else agent.tokens[key] = value;
      }
      return {};
    };
    await blink.run(e);
    assert.equal(writes.length, 1, status);
    assert.ok(agent.tokens["remark_lamp_" + expected]);
    assert.equal(agent.agent_status, status);
    assert.equal(agent.tokens.remark_seen, "1");
    assert.equal(blink.running(e), false);
  }
});
