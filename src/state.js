"use strict";

// Durable plugin state and user config.
//
// State lives in HERDR_PLUGIN_STATE_DIR/state.json and is the source of truth;
// Herdr pane tokens are only a projection of it, because tokens do not survive
// a cold server restart. Config lives in HERDR_PLUGIN_CONFIG_DIR/config.json.
//
// Event hooks can fire concurrently, so writes go through a directory-based
// lock and a temp-file rename.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const STATE_DIR =
  process.env.HERDR_PLUGIN_STATE_DIR ||
  path.join(os.tmpdir(), "herdr-agent-inform-state");
const CONFIG_DIR =
  process.env.HERDR_PLUGIN_CONFIG_DIR ||
  path.join(os.tmpdir(), "herdr-agent-inform-config");

const STATE_FILE = path.join(STATE_DIR, "state.json");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const LOCK_DIR = path.join(STATE_DIR, ".lock");

const DEFAULT_CONFIG = {
  // Agent statuses that automatically flag the pane unread.
  auto_mark_on: ["done", "blocked"],
  // Auto-flag even the pane you are currently looking at. Usually pointless.
  auto_mark_when_focused: false,
  // What focusing a pane clears.
  //   "auto"   - only entries auto-flagged by a status change that carry no
  //              remark. Anything you marked yourself, or annotated, survives
  //              until you clear it explicitly. This is what makes the sidebar
  //              mark usable as a queue: looking at a pane does not destroy it.
  //   "always" - clear any unread on focus. Legacy `true`.
  //   "never"  - focusing never clears. Legacy `false`.
  auto_clear_on_focus: "auto",
  // Desktop popup when a pane is auto-flagged. Requires [ui.toast] delivery
  // to be something other than "off" in Herdr's own config.toml.
  notify_on_auto_mark: true,
  // Popup when you manually mark unread. On by default: a keybinding gives no
  // other feedback that it fired, and a silent no-op is indistinguishable from
  // a broken binding.
  notify_on_manual_mark: true,
  // Sound for popups: auto | none | done | request
  notify_sound: "auto",
  // Install the Agents view that floats unread agents to the top of the sidebar.
  sort_unread_first: true,
  // Prefix on the $inform token. "" to render the remark alone.
  unread_marker: "●",
  read_marker: "",
  // Shown after the marker when a pane is flagged but has no remark. Without it
  // the token is a bare dot on a row under state_icon, which is also a dot, so
  // pressing the toggle key produces no visible change. "" restores the dot.
  unread_text: "未读",
  // Max display width of the $inform token, in terminal columns.
  max_remark_width: 40,
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function loadConfig() {
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) || {};
  } catch {
    /* missing or malformed: defaults only */
  }
  const cfg = { ...DEFAULT_CONFIG, ...user };
  // auto_clear_on_focus was a boolean before 0.2.0. Keep old files working.
  if (cfg.auto_clear_on_focus === true) cfg.auto_clear_on_focus = "always";
  else if (cfg.auto_clear_on_focus === false) cfg.auto_clear_on_focus = "never";
  else if (!["auto", "always", "never"].includes(cfg.auto_clear_on_focus)) {
    cfg.auto_clear_on_focus = DEFAULT_CONFIG.auto_clear_on_focus;
  }
  return cfg;
}

function writeDefaultConfigIfMissing() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return false;
    ensureDir(CONFIG_DIR);
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n",
      "utf8",
    );
    return true;
  } catch {
    return false;
  }
}

function emptyState() {
  return { version: 1, panes: {} };
}

function readState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.panes) {
      return emptyState();
    }
    return parsed;
  } catch {
    return emptyState();
  }
}

function writeStateUnlocked(state) {
  ensureDir(STATE_DIR);
  const tmp = path.join(STATE_DIR, `.state.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, STATE_FILE);
}

function acquireLock({ retries = 60, waitMs = 25 } = {}) {
  ensureDir(STATE_DIR);
  for (let i = 0; i < retries; i += 1) {
    try {
      fs.mkdirSync(LOCK_DIR);
      return true;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      // Break a lock left behind by a killed process.
      try {
        const age = Date.now() - fs.statSync(LOCK_DIR).mtimeMs;
        if (age > 5000) {
          fs.rmSync(LOCK_DIR, { recursive: true, force: true });
          continue;
        }
      } catch {
        /* raced with the holder; fall through to sleep */
      }
      sleepSync(waitMs);
    }
  }
  return false;
}

function releaseLock() {
  try {
    fs.rmSync(LOCK_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function sleepSync(ms) {
  const shared = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(shared), 0, 0, ms);
}

/**
 * Read-modify-write the state file under the lock. `fn` receives the state and
 * may mutate it; its return value is passed back to the caller.
 */
function updateState(fn) {
  const locked = acquireLock();
  try {
    const state = readState();
    const result = fn(state);
    writeStateUnlocked(state);
    return result;
  } finally {
    if (locked) releaseLock();
  }
}

function getPane(state, paneId) {
  return state.panes[paneId] || null;
}

function setPane(state, paneId, entry) {
  if (!entry || (!entry.unread && !entry.note)) {
    delete state.panes[paneId];
    return null;
  }
  state.panes[paneId] = entry;
  return entry;
}

function unreadEntries(state) {
  return Object.entries(state.panes)
    .filter(([, v]) => v && (v.unread || v.note))
    .sort((a, b) => (b[1].marked_at || 0) - (a[1].marked_at || 0));
}

module.exports = {
  STATE_DIR,
  CONFIG_DIR,
  STATE_FILE,
  CONFIG_FILE,
  DEFAULT_CONFIG,
  loadConfig,
  writeDefaultConfigIfMissing,
  readState,
  updateState,
  getPane,
  setPane,
  unreadEntries,
};
