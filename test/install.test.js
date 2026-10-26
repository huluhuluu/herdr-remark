"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { configPath, mergeConfig, install } = require("../scripts/install");
const example = fs.readFileSync(path.join(__dirname, "..", "config.example.toml"), "utf8");

test("config paths follow Windows, macOS, Linux and Herdr overrides", () => {
  assert.equal(configPath({ APPDATA: "C:/profile/Roaming" }, "win32"), path.resolve("C:/profile/Roaming/herdr/config.toml"));
  assert.equal(configPath({ HOME: "/home/user" }, "linux"), path.resolve("/home/user/.config/herdr/config.toml"));
  assert.equal(configPath({ HOME: "/Users/user" }, "darwin"), path.resolve("/Users/user/.config/herdr/config.toml"));
  assert.equal(configPath({ HOME: "/Users/user", XDG_CONFIG_HOME: "/custom" }, "darwin"), path.resolve("/custom/herdr/config.toml"));
  assert.equal(configPath({ HERDR_CONFIG_PATH: "/active.toml", XDG_CONFIG_HOME: "/ignored" }, "darwin"), path.resolve("/active.toml"));
  assert.equal(configPath({ XDG_CONFIG_HOME: "/custom", APPDATA: "C:/ignored" }, "win32"), path.resolve("/custom/herdr/config.toml"));
  assert.equal(configPath({ HERDR_CONFIG_PATH: "/custom/config.toml" }, "linux"), path.resolve("/custom/config.toml"));
});

test("POSIX installer preserves spaced paths and arguments with CDPATH set", { skip: process.platform === "win32" }, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remark shell test "));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const scripts = path.join(dir, "scripts");
  fs.mkdirSync(scripts);
  fs.copyFileSync(path.join(__dirname, "../scripts/install.sh"), path.join(scripts, "install.sh"));
  fs.writeFileSync(path.join(scripts, "install.js"), 'console.log(JSON.stringify(process.argv.slice(2))); process.exitCode = 7;');
  const result = spawnSync("/bin/sh", ["scripts/install.sh", "--check", "two words"], {
    cwd: dir, env: { ...process.env, CDPATH: dir }, encoding: "utf8", timeout: 5000,
  });
  assert.equal(result.status, 7, result.stderr || result.error?.message);
  assert.deepEqual(JSON.parse(result.stdout), ["--check", "two words"]);
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

test("shortcut conflicts follow the example instead of a fixed key whitelist", () => {
  const custom = example.replace('key = "prefix+u"', 'key = "ctrl+r"');
  assert.throws(() => mergeConfig('[[keys.command]]\nkey = "ctrl+r"\ncommand = "custom"\n', custom), /keybindings/);
  assert.doesNotThrow(() => mergeConfig('# Previously used huluhlu.agent-inform.note\n', custom));
});

test("markers and settings inside multiline shell commands are preserved as string content", () => {
  for (const quote of ["'''", '\"\"\"']) {
    const current = `[[keys.command]]
key = "prefix+h"
type = "shell"
command = ${quote}
# herdr-remark begin
[ui.sidebar.agents]
key = "prefix+u"
# herdr-remark end
${quote}
`;
    const merged = mergeConfig(current, example);
    assert.ok(merged.startsWith(current));
    assert.ok(merged.endsWith("# herdr-remark end\n"));
    assert.equal(mergeConfig(merged, example), merged);
  }
});

test("escaped TOML shortcut strings are checked by their actual value", () => {
  assert.throws(() => mergeConfig(String.raw`[[keys.command]]
key = "prefix\u002bu"
command = "custom"
`, example), /keybindings/);
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
    if (args[0] === "--version") return bin.includes("git") ? "git version 2.45" : "herdr 0.9.5-custom.1";
    if (command === "config check") assert.ok(fs.readFileSync(env.HERDR_CONFIG_PATH, "utf8").includes("remark_lamp_unread"));
    if (command.startsWith(fail) && fail) throw Error("simulated failure");
    if (command === "server reload-config") return JSON.stringify({ result: { status: "applied", diagnostics: [] } });
    return "";
  };
  return { dir, target, original, execute, calls };
}

test("the installer uses HERDR_BIN_PATH when herdr is not on PATH", t => {
  const f = fixture(t);
  const previous = process.env.HERDR_BIN_PATH;
  process.env.HERDR_BIN_PATH = "/opt/herdr/bin/herdr";
  try {
    const bins = [];
    const execute = (bin, args, env) => { bins.push(bin); return f.execute(bin, args, env); };
    install({ ...f, execute });
    assert.ok(bins.includes("/opt/herdr/bin/herdr"));
    assert.equal(bins.includes("herdr"), false);
  } finally {
    if (previous === undefined) delete process.env.HERDR_BIN_PATH;
    else process.env.HERDR_BIN_PATH = previous;
  }
});

test("installation requires the native completion contract from Herdr 0.9.5", t => {
  const f = fixture(t);
  const execute = (bin, args, env) => args[0] === "--version" && !bin.includes("git")
    ? "herdr 0.9.4" : f.execute(bin, args, env);
  assert.throws(() => install({ ...f, execute }), /Herdr 0\.9\.5\+ is required/);
  assert.equal(fs.readFileSync(f.target, "utf8"), f.original);
  assert.equal(f.calls.some(command => command.startsWith("plugin link")), false);
});

test("check validates without linking or changing the user's config", t => {
  const f = fixture(t);
  assert.equal(install({ ...f, check: true }).checked, true);
  assert.equal(fs.readFileSync(f.target, "utf8"), f.original);
  assert.deepEqual(fs.readdirSync(f.dir), ["config.toml"]);
  assert.equal(f.calls.some(c => c.startsWith("plugin link")), false);
});

test("invalid UTF-8 config is rejected without modifying or linking it", t => {
  for (const check of [true, false]) {
    const f = fixture(t);
    const original = Buffer.concat([Buffer.from("# existing note: "), Buffer.from([0xff]), Buffer.from("\n")]);
    fs.writeFileSync(f.target, original);
    assert.throws(() => install({ ...f, check }), /UTF-8/);
    assert.deepEqual(fs.readFileSync(f.target), original);
    assert.deepEqual(fs.readdirSync(f.dir), ["config.toml"]);
    assert.equal(f.calls.some(c => c.startsWith("plugin link")), false);
  }
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

test("POSIX install preserves config permissions despite a restrictive umask", { skip: process.platform === "win32" }, t => {
  const f = fixture(t);
  fs.chmodSync(f.target, 0o640);
  const previous = process.umask(0o077);
  try {
    const result = install(f);
    assert.equal(fs.statSync(f.target).mode & 0o777, 0o640);
    assert.equal(fs.statSync(result.backup).mode & 0o777, 0o640);
  } finally { process.umask(previous); }
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

test("concurrent config edits are compared as bytes, including invalid replacement sequences", t => {
  const f = fixture(t);
  fs.writeFileSync(f.target, "# existing note: \ufffd\n");
  const external = Buffer.concat([Buffer.from("# existing note: "), Buffer.from([0xff]), Buffer.from("\n")]);
  const execute = (bin, args, env) => {
    if (args[0] === "plugin") fs.writeFileSync(f.target, external);
    return f.execute(bin, args, env);
  };
  assert.throws(() => install({ ...f, execute }), /changed during installation/);
  assert.deepEqual(fs.readFileSync(f.target), external);
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

test("reload rollback also compares bytes before overwriting concurrent edits", t => {
  const f = fixture(t);
  fs.writeFileSync(f.target, "# original replacement character: \ufffd\n");
  let external;
  const execute = (bin, args, env) => {
    if (args.join(" ") === "server reload-config") {
      const installed = fs.readFileSync(f.target);
      const offset = installed.indexOf(Buffer.from("\ufffd"));
      external = Buffer.concat([installed.subarray(0, offset), Buffer.from([0xff]), installed.subarray(offset + Buffer.byteLength("\ufffd"))]);
      fs.writeFileSync(f.target, external);
      throw Error("reload interrupted");
    }
    return f.execute(bin, args, env);
  };
  assert.throws(() => install({ ...f, execute }), /left it untouched/);
  assert.deepEqual(fs.readFileSync(f.target), external);
});

test("reload failure in a successful CLI response is not reported as installed", t => {
  for (const status of ["failed", "partial"]) {
    const f = fixture(t);
    const execute = (bin, args, env) => args.join(" ") === "server reload-config"
      ? JSON.stringify({ result: { status, diagnostics: ["invalid config"] } })
      : f.execute(bin, args, env);
    assert.throws(() => install({ ...f, execute }), /Config reload/);
    assert.equal(fs.readFileSync(f.target, "utf8"), f.original);
    assert.equal(f.calls.some(c => c.endsWith("remark.js reload")), false);
  }
});

test("a partial reload restores the previous running config as well as its file", t => {
  const f = fixture(t);
  let running = f.original;
  let reloads = 0;
  const execute = (bin, args, env) => {
    if (args.join(" ") === "server reload-config") {
      running = fs.readFileSync(f.target, "utf8");
      return JSON.stringify({ result: { status: ++reloads === 1 ? "partial" : "applied" } });
    }
    return f.execute(bin, args, env);
  };
  assert.throws(() => install({ ...f, execute }), /previous config restored/);
  assert.equal(fs.readFileSync(f.target, "utf8"), f.original);
  assert.equal(running, f.original);
  assert.equal(reloads, 2);
});

test("a failed rollback reload distinguishes restored files from running settings", t => {
  const f = fixture(t, "server reload-config");
  assert.throws(() => install(f), /restored on disk.*runtime reload failed/);
  assert.equal(fs.readFileSync(f.target, "utf8"), f.original);
  assert.equal(f.calls.filter(command => command === "server reload-config").length, 2);
});

test("a failed init warns without discarding a successful install", t => {
  const f = fixture(t);
  const execute = (bin, args, env) => {
    if (args.join(" ").endsWith("remark.js reload")) throw Error("init unavailable");
    return f.execute(bin, args, env);
  };
  const result = install({ ...f, execute });
  // The config and link are live, so the install counts as done...
  assert.ok(fs.readFileSync(f.target, "utf8").includes("# herdr-remark begin"));
  assert.ok(f.calls.some(c => c.startsWith("plugin link")));
  // ...and the failure surfaces as a warning with the recovery command.
  assert.match(result.warning, /Rerun: npm run init/);
});
