"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Blink settings live beside the plugin's other configuration so the animated
// working lamp can be switched off or slowed down without editing Herdr's own
// config.toml. A missing or malformed file falls back to these defaults rather
// than failing a hook: the sidebar must keep working either way.
const DEFAULTS = { blink: true, blinkIntervalMs: 800 };
const MIN_INTERVAL_MS = 100;
const MAX_INTERVAL_MS = 60000;

function filePath(env = process.env) {
  return env.HERDR_PLUGIN_CONFIG_DIR ? path.join(env.HERDR_PLUGIN_CONFIG_DIR, "config.json") : null;
}

function load(env = process.env) {
  let raw = {};
  const file = filePath(env);
  if (file) {
    try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch { raw = {}; }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) raw = {};
  const asked = Number(raw.blink_interval_ms);
  return {
    blink: raw.blink !== false,
    blinkIntervalMs: Number.isFinite(asked) && asked > 0
      ? Math.min(Math.max(asked, MIN_INTERVAL_MS), MAX_INTERVAL_MS)
      : DEFAULTS.blinkIntervalMs,
  };
}

module.exports = { DEFAULTS, MIN_INTERVAL_MS, MAX_INTERVAL_MS, filePath, load };
