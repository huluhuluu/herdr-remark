"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { configPath, mergeConfig, install } = require("../scripts/install");
const example = fs.readFileSync(path.join(__dirname, "..", "config.example.toml"), "utf8");

test("config paths follow Windows, Linux and Herdr overrides", () => {
  assert.equal(configPath({ APPDATA: "C:/profile/Roaming" }, "win32"), path.resolve("C:/profile/Roaming/herdr/config.toml"));
  assert.equal(configPath({ HOME: "/home/user" }, "linux"), path.resolve("/home/user/.config/herdr/config.toml"));
  assert.equal(configPath({ XDG_CONFIG_HOME: "/custom", APPDATA: "C:/ignored" }, "win32"), path.resolve("/custom/herdr/config.toml"));
  assert.equal(configPath({ HERDR_CONFIG_PATH: "/custom/config.toml" }, "linux"), path.resolve("/custom/config.toml"));
});

test("managed config updates are idempotent and preserve unrelated CRLF settings", () => {
  const unrelated = '[terminal]\r\ndefault_shell = "pwsh.exe"\r\n\r\n[[keys.command]]\r\nkey = "prefix+h"\r\ntype = "shell"\r\ncommand = "history"\r\n';
  const merged = mergeConfig(unrelated, example);
  assert.ok(merged.startsWith(unrelated));
  assert.ok(!/(?<!\r)\n/.test(merged));
  assert.equal(mergeConfig(merged, example), merged);
  const updated = mergeConfig(merged + '\r\n[theme]\r\nname = "nord"\r\n', example.replace("#89b4fa", "#112233"));
  assert.ok(updated.includes("#112233"));
  assert.ok(updated.endsWith('[theme]\r\nname = "nord"\r\n'));
  assert.equal((updated.match(/\[ui.sidebar.agents\]/g) || []).length, 1);
});

test("unmanaged layouts, bindings and malformed markers are rejected", () => {
  for (const text of [
    '[ui.sidebar.agents]\nrows = [["agent"]]',
    '[ui.sidebar.agents.rows_by_agent]\nclaude = [["pane"]]',
    "[[keys.command]]\nkey = 'prefix+Shift+u'\ncommand = 'custom'",
    '# herdr-remark begin\nmissing end', '# herdr-remark end\n# herdr-remark begin',
  ]) assert.throws(() => mergeConfig(text, example));
});

function fixture(t, fail = "") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remark-installer-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, "config.toml");
  const original = '[terminal]\ndefault_shell = "custom-shell"\n';
  fs.writeFileSync(target, original);
  const calls = [];
  const execute = (bin, args, env) => {
    const command = args.join(" ");
    calls.push(command);
    if (args[0] === "--version") return bin === "herdr" ? "herdr 0.8.2-custom.1" : "git version 2.45";
    if (command === "config check") assert.ok(fs.readFileSync(env.HERDR_CONFIG_PATH, "utf8").includes("remark_lamp_unread"));
    if (command.startsWith(fail) && fail) throw Error("simulated failure");
    if (command === "server reload-config") return JSON.stringify({ result: { status: "applied", diagnostics: [] } });
    return "";
  };
  return { dir, target, original, execute, calls };
}

test("check validates without linking or changing the user's config", t => {
  const f = fixture(t);
  assert.equal(install({ ...f, check: true }).checked, true);
  assert.equal(fs.readFileSync(f.target, "utf8"), f.original);
  assert.deepEqual(fs.readdirSync(f.dir), ["config.toml"]);
  assert.equal(f.calls.some(c => c.startsWith("plugin link")), false);
});

test("install backs up once and repeated install does not duplicate settings", t => {
  const f = fixture(t);
  const result = install(f);
  assert.equal(fs.readFileSync(result.backup, "utf8"), f.original);
  const installed = fs.readFileSync(f.target, "utf8");
  assert.equal(install(f).backup, undefined);
  assert.equal(fs.readFileSync(f.target, "utf8"), installed);
  assert.ok(f.calls.includes("server reload-config"));
});

test("validation/link failures leave config intact; reload failure restores it", t => {
  for (const step of ["config check", "plugin link", "server reload-config"]) {
    const f = fixture(t, step);
    assert.throws(() => install(f), /simulated failure/);
    assert.equal(fs.readFileSync(f.target, "utf8"), f.original);
    assert.equal(fs.readdirSync(f.dir).some(file => file.includes("remark-check")), false);
  }
});

test("first installation creates a config and removes it if reload fails", t => {
  const first = fixture(t);
  fs.unlinkSync(first.target);
  assert.equal(install(first).backup, undefined);
  assert.ok(fs.readFileSync(first.target, "utf8").includes("# herdr-remark begin"));
  const failed = fixture(t, "server reload-config");
  fs.unlinkSync(failed.target);
  assert.throws(() => install(failed), /previous config restored/);
  assert.equal(fs.existsSync(failed.target), false);
});

test("concurrent config changes are preserved instead of overwritten", t => {
  const f = fixture(t);
  const external = f.original + '\n[theme]\nname = "nord"\n';
  const execute = (bin, args, env) => {
    if (args[0] === "plugin") fs.writeFileSync(f.target, external);
    return f.execute(bin, args, env);
  };
  assert.throws(() => install({ ...f, execute }), /changed during installation/);
  assert.equal(fs.readFileSync(f.target, "utf8"), external);
});

test("failed reload does not roll back edits made after installation", t => {
  const f = fixture(t);
  const external = f.original + '\n[theme]\nname = "nord"\n';
  const execute = (bin, args, env) => {
    if (args.join(" ") === "server reload-config") {
      fs.writeFileSync(f.target, external);
      throw Error("reload interrupted");
    }
    return f.execute(bin, args, env);
  };
  assert.throws(() => install({ ...f, execute }), /left it untouched/);
  assert.equal(fs.readFileSync(f.target, "utf8"), external);
});

test("reload failure in a successful CLI response is not reported as installed", t => {
  for (const status of ["failed", "partial"]) {
    const f = fixture(t);
    const execute = (bin, args, env) => args.join(" ") === "server reload-config"
      ? JSON.stringify({ result: { status, diagnostics: ["invalid config"] } })
      : f.execute(bin, args, env);
    assert.throws(() => install({ ...f, execute }), /Config reload/);
    assert.equal(fs.readFileSync(f.target, "utf8"), f.original);
    assert.equal(f.calls.some(c => c.endsWith("remark.js init")), false);
  }
});
