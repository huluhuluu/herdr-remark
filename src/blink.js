"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const herdr = require("./herdr");
const settings = require("./settings");
const socket = require("./socket");
const wheel = require("./wheel");
const monitorLock = require("./monitor-lock");
const { LAMP_SOURCE, READ_SOURCE, LAMP_TOKENS, isUnread, lampTokens, readTokens, scrollBaseline,
  sameReadState, sessionKey, sessionChanged } = require("./tokens");

// Herdr token styles are static: fg, bold and dim are fixed per token in
// config.toml, and there is no per-frame event a plugin can hook. A
// lamp therefore only animates if something keeps rewriting its token value, so
// a working agent's yellow lamp pulses between two tokens: the bright
// `remark_lamp_working` and a dimmed twin. Alternating tokens rather than
// glyphs keeps the directory text in place and uses Herdr's own dim style.
const IDLE_TICKS_BEFORE_EXIT = 2;
const WHEEL_RETRY_MS = 5000;

function sharedStateDir(env) {
  return env.HERDR_PLUGIN_STATE_DIR ||
    path.join(os.tmpdir(), "herdr-remark-" + (env.HERDR_PLUGIN_ID || herdr.ID));
}

function stateDir(env = process.env) {
  const endpoint = socket.pipePath(env.HERDR_SOCKET_PATH);
  if (!endpoint) return sharedStateDir(env);
  // Plugin storage is shared across Herdr sessions; monitor ownership is not.
  const identity = process.platform === "win32" ? endpoint.toLowerCase() : endpoint;
  return path.join(sharedStateDir(env), "sessions", createHash("sha256").update(identity).digest("hex"));
}

function lockFile(env = process.env) {
  return path.join(stateDir(env), "blink.lock");
}

function lockOwner(env = process.env) {
  return monitorLock.owner(lockFile(env));
}

function claim(env = process.env) {
  return monitorLock.claim(lockFile(env));
}

function release(env = process.env) {
  monitorLock.release(lockFile(env));
}

function running(env = process.env) {
  return lockOwner(env) !== 0;
}

function stamp(env, name) {
  try { return fs.readFileSync(path.join(stateDir(env), "blink." + name), "utf8"); }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}

function requestReload(env = process.env) {
  if (!env.HERDR_SOCKET_PATH || !env.HERDR_PLUGIN_STATE_DIR) return;
  // An older monitor may still own the shared lock after an update. Ask it to
  // release and restart with its own inherited socket, without stopping Agents.
  for (const directory of new Set([stateDir(env), sharedStateDir(env)])) {
    if (monitorLock.owner(path.join(directory, "blink.lock")))
      fs.writeFileSync(path.join(directory, "blink.reload"), String(herdr.sequence()));
  }
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
  const live = (await socket.request("agent.list", {}, options)).agents?.find(agent => sameReadState(watched, agent));
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
  const loadedStamp = stamp(env, "reload");
  if (!await claim(env)) return;
  const options = { socketPath: env.HERDR_SOCKET_PATH };
  let on = true;
  let idle = 0;
  const touched = new Set();
  let watched = new Map();
  const positions = new Map();
  let subscription;
  let wheelMonitor;
  let wheelRetryAt = 0;
  let reload = false;
  let observedWake = stamp(env, "wake");
  let pending = Promise.resolve();
  const reading = new Set();
  const queueRead = (agent, seq, fresh = false) => {
    if (reading.has(agent.pane_id)) return;
    reading.add(agent.pane_id);
    // Capture at scroll receipt, before waiting behind other panes. The poll's
    // generation may already be stale; acknowledge still validates this snapshot.
    const snapshot = fresh ? socket.request("agent.list", {}, options).then(result =>
      result.agents?.find(item => item.pane_id === agent.pane_id && item.terminal_id === agent.terminal_id &&
        sessionKey(item) === sessionKey(agent)))
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
      if (stamp(env, "reload") !== loadedStamp) { reload = true; break; }
      observedWake = stamp(env, "wake");
      const config = settings.load(env);
      const seq = herdr.sequence();
      let agents;
      try { agents = (await socket.request("agent.list", {}, options)).agents || []; }
      catch (error) {
        record(error, env);
        // A failed poll need not strand unread panes until the next lifecycle
        // event. Keep the existing subscription if this server is still alive.
        await socket.request("ping", {}, options);
        await sleep(config.blinkIntervalMs);
        continue;
      }
      // A /new identity report need not change the native lifecycle status.
      // Reconcile old unread lamps while this session's monitor is still awake.
      for (const agent of agents.filter(sessionChanged)) {
        try { require("./remark").update({ pane_id: agent.pane_id }); }
        catch (error) { record(error, env); }
      }
      const byId = new Map(agents.map(agent => [agent.pane_id, agent]));
      const working = config.blink ? agents.filter(agent => agent.agent_status === "working") : [];
      on = !on;
      for (const agent of working) touched.add(agent.pane_id);
      for (const agent of agents) {
        if (config.blink && agent.agent_status === "working") continue;
        const tokens = agent.tokens || {};
        if (!LAMP_TOKENS.some(key => tokens[key] != null)) continue;
        const expected = lampTokens(agent);
        if (LAMP_TOKENS.some(key => (tokens[key] ?? null) !== expected[key])) touched.add(agent.pane_id);
      }
      for (const paneId of touched) {
        const agent = byId.get(paneId) || { pane_id: paneId };
        const animating = config.blink && agent.agent_status === "working";
        try {
          await socket.request("pane.report_metadata", {
            pane_id: paneId, source: LAMP_SOURCE, seq, tokens: lampTokens(agent, animating ? on : true),
          }, options);
          if (!animating) touched.delete(paneId);
        } catch { /* retry from a fresh snapshot on the next tick */ }
      }
      const unread = new Map(agents.filter(isUnread)
        .map(agent => [agent.pane_id, agent]));
      // Hooks can publish the round's baseline after our first poll. Reconcile
      // changed generations/marks even when the subscribed pane ids stay the same.
      const changed = unread.size !== watched.size || [...unread].some(([id, agent]) => {
        const previous = watched.get(id);
        return !previous || previous.terminal_id !== agent.terminal_id ||
          sessionKey(previous) !== sessionKey(agent) ||
          previous.tokens?.remark_activity !== agent.tokens?.remark_activity ||
              previous.tokens?.remark_session !== agent.tokens?.remark_session ||
          previous.tokens?.remark_unread !== agent.tokens?.remark_unread;
      });
      watched = unread;
      if (wheelMonitor?.closed) wheelMonitor = undefined;
      if (watched.size && config.wheelRead !== false && !wheelMonitor && Date.now() >= wheelRetryAt) {
        wheelRetryAt = Date.now() + WHEEL_RETRY_MS;
        wheelMonitor = wheel.start(() => watched, queueRead, error => record(error, env), env);
      }
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
              if (scrolled(scrollBaseline(agent), pane.scroll)) queueRead(agent, seq);
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
            pane_id: paneId, source: LAMP_SOURCE, seq, tokens: lampTokens(pane),
          }, options); } catch { /* pane closed or server gone */ }
        }
      }
    } catch { /* a later event refreshes lamps when the server is reachable */ }
    release(env);
  }
  // A start request can arrive after the last snapshot but before release.
  // Read its stamp after unlocking: later requests can start a monitor directly.
  if (reload || stamp(env, "wake") !== observedWake) module.exports.start(env, true);
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
  try {
    fs.mkdirSync(stateDir(env), { recursive: true });
    fs.writeFileSync(path.join(stateDir(env), "blink.wake"), String(herdr.sequence()));
    if (running(env)) return false;
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

module.exports = { stateDir, lockFile, lockOwner, claim, release, running,
  scrolled, acknowledge, requestReload, start, run };
