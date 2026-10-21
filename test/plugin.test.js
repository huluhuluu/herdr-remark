"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { versionAtLeast } = require("../src/plugin");

test("plugin identity and minimum versions come from the checkout's manifests", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "remark-plugin-info-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"));
  for (const file of ["plugin.js", "herdr.js"])
    fs.copyFileSync(path.join(__dirname, "../src", file), path.join(root, "src", file));
  fs.writeFileSync(path.join(root, "herdr-plugin.toml"), 'id = "vendor.custom-remark"\nmin_herdr_version = "1.2.3"\n[[actions]]\nid = "refresh"\n');
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ engines: { node: ">=21" } }));
  const result = spawnSync(process.execPath, ["-e", `
    const plugin = require('./src/plugin');
    console.log(JSON.stringify([require('./src/herdr').ID, plugin.MIN_HERDR_VERSION, plugin.NODE_REQUIREMENT]));
  `], { cwd: root, env: { ...process.env, HERDR_PLUGIN_ID: "" }, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ["vendor.custom-remark", "1.2.3", ">=21"]);
});

test("version comparisons follow numeric components and reject missing versions", () => {
  assert.equal(versionAtLeast("herdr 0.10.0", "0.9.9"), true);
  assert.equal(versionAtLeast("herdr 1.0.0", "0.99.99"), true);
  assert.equal(versionAtLeast("herdr 0.8.1", "0.8.2"), false);
  assert.equal(versionAtLeast("herdr 0.8.2-custom.1", "0.8.2"), true);
  assert.equal(versionAtLeast("18.0.0", ">=18"), true);
  assert.equal(versionAtLeast("17.9.9", ">=18"), false);
  assert.equal(versionAtLeast("unavailable", "0.8.2"), false);
});
