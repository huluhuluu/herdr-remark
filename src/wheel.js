"use strict";

const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const socket = require("./socket");
const herdr = require("./herdr");

// Whole visible lines let UI Automation locate the pane without guessing the
// sidebar width, font metrics, Unicode cell widths, or the caller's HERDR_PANE_ID.
function anchors(text) {
  const seen = new Set();
  return String(text || "").split(/\r?\n/).flatMap((line, row) => {
    const value = line.trimEnd();
    if (value.length < 12 || (value.match(/[\p{L}\p{N}]/gu) || []).length < 6 || seen.has(value)) return [];
    seen.add(value);
    return [{ row, text: value }];
  });
}

async function target(event, watched, verify, options) {
  if (!event.foreground || !event.delta) return;
  const snapshot = (await socket.request("session.snapshot", {}, options)).snapshot;
  const agent = snapshot?.agents?.find(item => item.pane_id === snapshot.focused_pane_id);
  const previous = watched.get(agent?.pane_id);
  if (!previous || previous.terminal_id !== agent.terminal_id ||
      previous.state_change_seq !== agent.state_change_seq ||
      previous.completion_seq !== agent.completion_seq ||
      previous.tokens?.remark_unread !== agent.tokens?.remark_unread) return;
  const layout = snapshot.layouts?.find(item => item.tab_id === snapshot.focused_tab_id);
  const rect = layout?.panes?.find(item => item.pane_id === agent.pane_id)?.rect;
  if (!rect?.width || !rect.height) return;
  const read = (await socket.request("pane.read", {
    pane_id: agent.pane_id, source: "visible", format: "text",
  }, options)).read;
  const lines = anchors(read?.text).filter(item => item.row < rect.height);
  if (lines.length < 2) return;
  if (await verify({ ...event, anchors: lines, width: rect.width, height: rect.height })) return previous;
}

// One optional native helper belongs to the existing monitor. No terminal
// wrapper, agent hook, dependency installation, or persistent input log.
function start(getWatched, onRead, onError, env = process.env) {
  if (process.platform !== "win32") return { close() {} };
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", path.join(__dirname, "..", "scripts", "wheel.ps1")], {
    windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env,
  });
  let closed = false;
  let busy = false;
  let id = 0;
  let waiting;
  let errors = "";
  const lines = readline.createInterface({ input: child.stdout });
  const settle = value => {
    if (!waiting) return;
    clearTimeout(waiting.timer);
    waiting.resolve(value);
    waiting = undefined;
  };
  const close = () => {
    if (closed) return;
    closed = true;
    settle(false);
    lines.close();
    child.kill(); // Windows removes the process's hook even if UIA is unresponsive.
  };
  child.stderr.on("data", data => { errors = (errors + data.toString()).slice(-2000); });
  child.on("error", error => { if (!closed) onError(error); close(); });
  child.stdin.on("error", error => { if (!closed) onError(error); close(); });
  child.on("exit", code => {
    if (!closed && code !== 0) onError(new Error("Wheel helper exited: " + (errors || code)));
    close();
  });
  const verify = request => new Promise(resolve => {
    if (closed) return resolve(false);
    waiting = { id: ++id, resolve, timer: setTimeout(() => {
      onError(new Error("Wheel verification timed out"));
      close();
    }, 3000) };
    child.stdin.write(JSON.stringify({ ...request, id, event: "verify" }) + "\n");
  });
  lines.on("line", line => {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    if (event.event === "verified") {
      if (event.id === waiting?.id) settle(event.matched === true);
      return;
    }
    if (closed || busy || event.event !== "wheel") return;
    busy = true;
    const seq = herdr.sequence();
    const watched = new Map(getWatched());
    target(event, watched, verify, { socketPath: env.HERDR_SOCKET_PATH })
      .then(agent => { if (!closed && agent) onRead(agent, seq); })
      .catch(onError).finally(() => { busy = false; });
  });
  return { close };
}

module.exports = { anchors, target, start };
