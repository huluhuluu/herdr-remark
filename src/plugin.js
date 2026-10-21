"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
// Only read the manifest's root string fields; action tables have their own ids.
const header = fs.readFileSync(path.join(ROOT, "herdr-plugin.toml"), "utf8").split(/^\s*\[/m)[0];
function field(name) {
  const match = header.match(new RegExp(`^\\s*${name}\\s*=\\s*["']([^"'\\r\\n]+)["']`, "m"));
  if (!match) throw new Error(`Missing ${name} in herdr-plugin.toml`);
  return match[1];
}
const PLUGIN_ID = field("id");
const MIN_HERDR_VERSION = field("min_herdr_version");
const NODE_REQUIREMENT = require("../package.json").engines.node;

function versionAtLeast(actual, required) {
  const parts = value => String(value).match(/\b(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  const found = parts(actual), minimum = parts(required);
  if (!found || !minimum) return false;
  for (let i = 1; i <= 3; i++) {
    const difference = Number(found[i] || 0) - Number(minimum[i] || 0);
    if (difference) return difference > 0;
  }
  return true;
}

module.exports = { ROOT, PLUGIN_ID, MIN_HERDR_VERSION, NODE_REQUIREMENT, versionAtLeast };
