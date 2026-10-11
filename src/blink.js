"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const herdr = require("./herdr");
const settings = require("./settings");
const socket = require("./socket");
const wheel = require("./wheel");
const { LAMP_SOURCE, READ_SOURCE, stateOf, lampTokens, readTokens } = require("./tokens");

// Herdr token styles are static: fg, bold and dim are fixed per token in
// config.toml, and there is no per-frame event a plugin can hook. A
// lamp therefore only animates if something keeps rewriting its token value, so
// a working agent's yellow lamp pulses between two tokens: the bright
// `remark_lamp_working` and a dimmed twin. Alternating tokens rather than
// glyphs keeps the directory text in place and uses Herdr's own dim style.
const ON = "remark_lamp_working";
const OFF = "remark_lamp_working_blink";
// The event hook and monitor share the lamp source and full lamp renderer.
// Neither can leave half of an old state behind or invalidate text/user writes.
const SOURCE = LAMP_SOURCE;
const IDLE_TICKS_BEFORE_EXIT = 2;

function stateDir(env = process.env) {
  return env.HERDR_PLUGIN_STATE_DIR ||
    path.join(os.tmpdir(), "herdr-remark-" + (env.HERDR_PLUGIN_ID || herdr.ID));
}

function lockFile(env = process.env) {
  return path.join(stateDir(env), "blink.lock");
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}

function lockOwner(env = process.env) {
  try { return Number(fs.readFileSync(lockFile(env), "utf8").trim()) || 0; }
  catch { return 0; }
}

// Only one daemon may drive the lamps, or two of them would fight over the
// phase and the lamp would look steady instead of blinking. `wx` makes claiming
// atomic; a lock left by a dead process is taken over.
function claim(env = process.env) {
  const file = lockFile(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: "wx" });
      return true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const owner = lockOwner(env);
      if (alive(owner)) return false;
      // A contender can see the exclusive file before its PID has been written.
      if (!owner && Date.now() - fs.statSync(file).mtimeMs < 5000) return false;
      fs.rmSync(file, { force: true });
    }
  }
  return false;
}

function release(env = process.env) {
  const file = lockFile(env);
  if (lockOwner(env) === process.pid) fs.rmSync(file, { force: true });
}

function running(env = process.env) {
  const owner = lockOwner(env);
  return alive(owner);
}

function reloadStamp(env) {
  try { return fs.readFileSync(path.join(stateDir(env), "blink.reload"), "utf8"); }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}

function requestReload(env = process.env) {
  if (!env.HERDR_SOCKET_PATH || !env.HERDR_PLUGIN_STATE_DIR || !running(env)) return;
  fs.writeFileSync(path.join(stateDir(env), "blink.reload"), String(herdr.sequence()));
}

function scrolled(previous, next) {
  if (!previous || !next || previous.viewport_rows !== next.viewport_rows) return false;
  const offset = next.offset_from_bottom - previous.offset_from_bottom;
  const growth = next.max_offset_from_bottom - previous.max_offset_from_bottom;
  // New output while scrolled up increases both offsets equally. Resizing is
  // also not evidence of reading. Any actual movement in either direction is.
  return Number.isFinite(offset) && Number.isFinite(growth) && offset !== 0 && offset !== growth;
}

async function acknowledge(watched, seq, env = process.env) {
  const options = { socketPath: env.HERDR_SOCKET_PATH };
  const live = (await socket.request("agent.list", {}, options)).agents?.find(agent =>
    agent.pane_id === watched.pane_id && agent.terminal_id === watched.terminal_id &&
    agent.state_change_seq === watched.state_change_seq &&
    agent.completion_seq === watched.completion_seq &&
    agent.tokens?.remark_unread === watched.tokens?.remark_unread);
  if (!live) return;
  await socket.request("pane.report_metadata", {
    pane_id: live.pane_id, source: READ_SOURCE, seq, tokens: readTokens(live, false),
  }, options);
  // Reuse the normal refresh so scrolling also checks directory, Tab and branch.
  require("./remark").update({ pane_id: live.pane_id });
}

function record(error, env = process.env) {
  try {
    fs.mkdirSync(stateDir(env), { recursive: true });
    fs.writeFileSync(path.join(stateDir(env), "blink-error.log"),
      new Date().toISOString() + " " + (error?.stack || error) + "\n");
  } catch { /* the log is best effort; never mask the original failure */ }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run(env = process.env) {
  if (!env.HERDR_SOCKET_PATH) return;
  const loadedStamp = reloadStamp(env);
  if (!claim(env)) return;
  const options = { socketPath: env.HERDR_SOCKET_PATH };
  let on = true;
  let idle = 0;
  const touched = new Set();
  let watched = new Map();
  const positions = new Map();
  let subscription;
  let wheelMonitor;
  let reload = false;
  let pending = Promise.resolve();
  const reading = new Set();
  const queueRead = (agent, seq, fresh = false) => {
    if (reading.has(agent.pane_id)) return;
    reading.add(agent.pane_id);
    // Capture at scroll receipt, before waiting behind other panes. The poll's
    // generation may already be stale; acknowledge still validates this snapshot.
    const snapshot = fresh ? socket.request("agent.list", {}, options).then(result =>
      result.agents?.find(item => item.pane_id === agent.pane_id && item.terminal_id === agent.terminal_id))
      : Promise.resolve(agent);
    // Attach rejection handling immediately, even while another read is pending.
    const captured = snapshot.catch(error => { record(error, env); return null; });
    pending = pending.then(async () => {
      const value = await captured;
      if (value) await acknowledge(value, seq, env);
    })
      .catch(error => record(error, env)).finally(() => reading.delete(agent.pane_id));
  };
  const observeScroll = (pane_id, scroll, seq, fresh) => {
    const previous = positions.get(pane_id);
    positions.set(pane_id, scroll);
    const agent = watched.get(pane_id);
    if (!agent || reading.has(pane_id) || !scrolled(previous, scroll)) return;
    queueRead(agent, seq, fresh);
  };
  try {
    for (;;) {
      if (reloadStamp(env) !== loadedStamp) { reload = true; break; }
      const config = settings.load(env);
      const seq = herdr.sequence();
      const agents = (await socket.request("agent.list", {}, options)).agents || [];
      const byId = new Map(agents.map(agent => [agent.pane_id, agent]));
      const working = config.blink ? agents.filter(agent => agent.agent_status === "working") : [];
      on = !on;
      for (const agent of working) touched.add(agent.pane_id);
      for (const paneId of touched) {
        const agent = byId.get(paneId) || { pane_id: paneId };
        const animating = config.blink && agent.agent_status === "working";
        try {
          await socket.request("pane.report_metadata", {
            pane_id: paneId, source: SOURCE, seq, tokens: lampTokens(agent, animating ? on : true),
          }, options);
          if (!animating) touched.delete(paneId);
        } catch { /* retry from a fresh snapshot on the next tick */ }
      }
      const unread = new Map(agents.filter(agent => agent.tokens?.remark_unread || stateOf(agent) === "unread")
        .map(agent => [agent.pane_id, agent]));
      const changed = unread.size !== watched.size || [...unread.keys()].some(id => !watched.has(id));
      watched = unread;
      if (watched.size && config.wheelRead !== false && !wheelMonitor)
        wheelMonitor = wheel.start(() => watched, queueRead, error => record(error, env), env);
      if ((!watched.size || config.wheelRead === false) && wheelMonitor) {
        wheelMonitor.close();
        wheelMonitor = undefined;
      }
      if (changed || (watched.size && (!subscription || subscription.closed))) {
        subscription?.close();
        subscription = undefined;
        positions.clear();
        if (watched.size) {
          try {
            const panes = (await socket.request("pane.list", {}, options)).panes || [];
            for (const pane of panes) {
              const agent = watched.get(pane.pane_id);
              if (!agent) continue;
              positions.set(pane.pane_id, pane.scroll);
              let initial;
              try { initial = JSON.parse(agent.tokens?.remark_scroll || "null"); } catch { /* old token */ }
              if (scrolled(initial, pane.scroll)) queueRead(agent, seq);
            }
            subscription = socket.subscribe([...watched.keys()].map(pane_id =>
              ({ type: "pane.scroll_changed", pane_id })), event => {
              if (event.event !== "pane.scroll_changed") return;
              const { pane_id, scroll } = event.data;
              observeScroll(pane_id, scroll, herdr.sequence(), true);
            }, options);
            await subscription.ready;
            // Herdr establishes its own baseline when subscribing. Reconcile
            // movement after our first snapshot but before that baseline.
            const baselineSeq = herdr.sequence();
            const current = (await socket.request("pane.list", {}, options)).panes || [];
            for (const pane of current) if (watched.has(pane.pane_id))
              observeScroll(pane.pane_id, pane.scroll, baselineSeq, false);
          } catch (error) {
            subscription?.close();
            subscription = undefined;
            record(error, env);
          }
        }
      }
      if (!working.length && !watched.size) {
        if (++idle >= IDLE_TICKS_BEFORE_EXIT) break;
      } else idle = 0;
      await sleep(config.blinkIntervalMs);
    }
  } catch (error) {
    record(error, env);
  } finally {
    wheelMonitor?.close();
    subscription?.close();
    await pending;
    // Never restore a lamp from a stale working snapshot, even after an error.
    try {
      if (touched.size) {
        const seq = herdr.sequence();
        const agents = (await socket.request("agent.list", {}, options)).agents || [];
        for (const paneId of touched) {
          const pane = agents.find(agent => agent.pane_id === paneId) || { pane_id: paneId };
          try { await socket.request("pane.report_metadata", {
            pane_id: paneId, source: SOURCE, seq, tokens: lampTokens(pane),
          }, options); } catch { /* pane closed or server gone */ }
        }
      }
    } catch { /* a later event refreshes lamps when the server is reachable */ }
    release(env);
  }
  if (reload) module.exports.start(env, true);
}

// One monitor handles both animation and scroll-to-read; it exits when neither
// working lamps nor unread panes need it. Hooks reuse the running process.
function start(env = process.env, watchUnread = false) {
  // Without a socket the daemon could not repaint anything, and spawning a
  // process that is bound to fail would turn a cosmetic feature into noise.
  // A plain `npm run init` has no plugin state directory. Let Herdr's hooks own
  // the monitor instead of creating a second lock/daemon in a temporary folder.
  if (!env.HERDR_SOCKET_PATH || !env.HERDR_PLUGIN_STATE_DIR) return false;
  if (!settings.load(env).blink && !watchUnread) return false;
  if (running(env)) return false;
  try {
    const child = spawn(process.execPath, [path.join(__dirname, "blink.js")], {
      detached: true, stdio: "ignore", windowsHide: true, env,
    });
    child.on("error", error => record(error, env));
    child.unref();
    return true;
  } catch (error) {
    record(error, env);
    return false;
  }
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch(error => {
    record(error);
    process.exitCode = 1;
  });
}

module.exports = { ON, OFF, SOURCE, stateDir, lockFile, alive, lockOwner, claim, release, running,
  lampTokens, scrolled, acknowledge, requestReload, start, run };
