"use strict";
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const readline = require("node:readline");
const wheel = require("../src/wheel");
const socket = require("../src/socket");

const original = socket.request;
afterEach(() => { socket.request = original; });
const agent = () => ({ pane_id: "p2", terminal_id: "term2", state_change_seq: 42,
  completion_seq: 40, agent_status: "done", tokens: { remark_unread: "100" } });
const event = { foreground: true, delta: -120, window: 123, x: 800, y: 400 };
function fixture(live = agent(), text = "  Completed the requested changes\n  Both checks passed successfully") {
  const calls = [];
  socket.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "session.snapshot") return { snapshot: {
      focused_pane_id: "p2", focused_tab_id: "t2", agents: [live],
      layouts: [{ tab_id: "t1", panes: [{ pane_id: "p1", rect: { width: 5, height: 5 } }] },
        { tab_id: "t2", panes: [{ pane_id: "p2", rect: { x: 20, y: 10, width: 80, height: 30 } }] }],
    } };
    assert.equal(method, "pane.read");
    return { read: { text } };
  };
  return calls;
}

test("anchors keep pane offsets and Unicode, ignoring blank, repeated and decorative rows", () => {
  const lines = wheel.anchors("\n  完成当前任务并且保持原有测试链路  \n----------------\n  One meaningful line\n  One meaningful line");
  assert.deepEqual(lines, [{ row: 1, text: "  完成当前任务并且保持原有测试链路" },
    { row: 3, text: "  One meaningful line" }]);
});

test("wheel targets the actual focused pane and passes content and size to the native verifier", async () => {
  const calls = fixture();
  const watched = agent();
  let packet;
  const result = await wheel.target(event, new Map([["p2", watched]]), async request => {
    packet = request; return true;
  }, {});
  assert.equal(result, watched);
  assert.equal(packet.width, 80);
  assert.equal(packet.height, 30);
  assert.equal(packet.anchors.length, 2);
  assert.equal(calls[1].params.pane_id, "p2");
  assert.equal(calls[1].params.source, "visible");
});

test("unmatched terminal content cannot acknowledge a pane", async () => {
  fixture();
  assert.equal(await wheel.target(event, new Map([["p2", agent()]]), async () => false, {}), undefined);
});

test("wheel verification is independent of Agent names and native completion_seq availability", async () => {
  for (const name of ["codex", "dsh-tui", "dst", "claude", "opencode", "copilot", "custom-agent"]) {
    for (const nativeCompletion of [true, false]) {
      const watched = { ...agent(), agent: name };
      if (!nativeCompletion) delete watched.completion_seq;
      fixture(structuredClone(watched));
      const result = await wheel.target(event, new Map([["p2", watched]]), async request => {
        assert.equal(request.agent, undefined); // The native helper only sees geometry and text.
        return true;
      }, {});
      assert.equal(result, watched, name);
    }
  }
});

test("a wheel captured against an older round, terminal or manual mark cannot clear a newer one", async () => {
  for (const patch of [{ state_change_seq: 43 }, { completion_seq: 41 }, { terminal_id: "replacement" },
    { tokens: { remark_unread: "101" } }]) {
    fixture({ ...agent(), ...patch });
    let verified = false;
    assert.equal(await wheel.target(event, new Map([["p2", agent()]]), async () => { verified = true; return true; }, {}), undefined);
    assert.equal(verified, false);
  }
});

test("unwatched panes and background input perform no verification", async () => {
  const calls = fixture();
  const verify = () => { throw new Error("must not verify"); };
  assert.equal(await wheel.target({ ...event, foreground: false }, new Map(), verify, {}), undefined);
  assert.equal(calls.length, 0);
  assert.equal(await wheel.target(event, new Map(), verify, {}), undefined);
  assert.equal(calls.length, 1);
});

test("insufficient visible text is left unread", async () => {
  fixture(agent(), "\n>\n");
  assert.equal(await wheel.target(event, new Map([["p2", agent()]]), () => {
    throw new Error("must not verify");
  }, {}), undefined);
});

test("native helper handles UTF-8 verification and exits when its parent closes stdin", {
  skip: process.platform !== "win32", timeout: 45000,
}, async () => {
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", path.join(__dirname, "..", "scripts", "wheel.ps1")], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const lines = readline.createInterface({ input: child.stdout });
  const messages = [];
  let errors = "";
  child.stderr.on("data", data => { errors += data; });
  let deadline, phase, timedOut = false;
  const arm = (next, milliseconds) => {
    clearTimeout(deadline);
    phase = next;
    deadline = setTimeout(() => { timedOut = true; child.kill(); }, milliseconds);
  };
  // Cold Windows runners also pay PowerShell/.NET compiler startup. Keep the
  // protocol and EOF limits short so a real lifecycle regression still fails.
  arm("startup", 30000);
  try {
    const exit = new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); });
    lines.on("line", line => {
      const message = JSON.parse(line);
      messages.push(message);
      if (message.event === "hook_ready") {
        arm("verification", 5000);
        child.stdin.write(JSON.stringify({ event: "verify", id: 1,
          window: 0, time: 0, x: 0, y: 0, anchors: [{ row: 0, text: "不应读取或修改任何状态" }] }) + "\n");
      }
      if (message.event === "verified") { arm("EOF shutdown", 5000); child.stdin.end(); }
    });
    const code = await exit;
    assert.equal(code, 0, timedOut ? `Native helper timed out during ${phase}: ${errors}` : errors);
    assert.deepEqual(messages.find(item => item.event === "verified"), { event: "verified", id: 1, matched: false });
    assert.ok(messages.some(item => item.event === "hook_stopped"));
  } finally { clearTimeout(deadline); lines.close(); child.kill(); }
});
