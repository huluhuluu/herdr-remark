"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const ROOT = path.resolve(__dirname, "..");
const BEGIN = "# herdr-remark begin";
const END = "# herdr-remark end";

function configPath(env = process.env, platform = process.platform) {
  const base = env.XDG_CONFIG_HOME || (platform === "win32"
    ? env.APPDATA || path.join(env.USERPROFILE || os.homedir(), "AppData", "Roaming")
    : path.join(env.HOME || os.homedir(), ".config"));
  return path.resolve(env.HERDR_CONFIG_PATH || path.join(base, "herdr", "config.toml"));
}

function mergeConfig(current, example) {
  if (current.includes("\0")) throw Error("Config must be UTF-8 TOML.");
  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const text = current.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const starts = lines.flatMap((line, i) => line.trim() === BEGIN ? [i] : []);
  const ends = lines.flatMap((line, i) => line.trim() === END ? [i] : []);
  if (starts.length > 1 || ends.length !== starts.length || ends[0] < starts[0])
    throw Error("Invalid Remark config markers; fix the begin/end block before installing.");
  const outside = starts.length ? [...lines.slice(0, starts[0]), ...lines.slice(ends[0] + 1)].join("\n") : text;
  // Reject conflicting unmanaged settings instead of parsing/reformatting user TOML.
  if (/^\s*\[\s*ui\s*\.\s*sidebar\s*\.\s*agents(?:\s*\]|\s*\.)/m.test(outside) ||
      /^\s*key\s*=\s*["']prefix\+(?:shift\+)?u["']/im.test(outside) ||
      outside.includes("huluhlu.agent-inform.")) {
    throw Error("Existing sidebar or Remark keybindings found outside the managed block. Merge config.example.toml manually; no settings were changed.");
  }
  const block = [BEGIN, example.replace(/\r\n/g, "\n").trim(), END].join("\n");
  if (starts.length) lines.splice(starts[0], ends[0] - starts[0] + 1, block);
  else return (text.trimEnd() + (text.trim() ? "\n\n" : "") + block + "\n").replace(/\n/g, eol);
  return lines.join("\n").replace(/\n/g, eol);
}

function run(bin, args, env = {}) {
  const result = spawnSync(bin, args, {
    cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8", windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"], timeout: 30000,
  });
  if (result.error || result.status !== 0)
    throw Error(`${bin} ${args.join(" ")}: ${result.error?.message || result.stderr || result.stdout}`);
  return result.stdout;
}

function install({ target = configPath(), check = false, execute = run } = {}) {
  if (Number(process.versions.node.split(".")[0]) < 18) throw Error("Node.js 18+ is required.");
  execute("git", ["--version"]);
  const version = execute("herdr", ["--version"]).match(/(\d+)\.(\d+)\.(\d+)/);
  if (!version || (Number(version[1]) === 0 && (Number(version[2]) < 8 ||
      (Number(version[2]) === 8 && Number(version[3]) < 2)))) throw Error("Herdr 0.8.2+ is required.");
  target = fs.existsSync(target) ? fs.realpathSync(target) : path.resolve(target);
  const original = fs.existsSync(target) ? fs.readFileSync(target) : null;
  const merged = mergeConfig(original?.toString("utf8") || "", fs.readFileSync(path.join(ROOT, "config.example.toml"), "utf8"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const staged = `${target}.remark-check-${process.pid}.toml`;
  let backup;
  fs.writeFileSync(staged, merged, { flag: "wx", mode: original ? fs.statSync(target).mode & 0o777 : 0o600 });
  try {
    execute("herdr", ["config", "check"], { HERDR_CONFIG_PATH: staged });
    if (check) return { target, checked: true };
    // Linking needs a running Herdr session. Failure here leaves the config intact.
    execute("herdr", ["plugin", "link", ROOT]);
    if ((fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null) !== (original?.toString("utf8") ?? null))
      throw Error("Config changed during installation; rerun the installer.");
    const changed = merged !== original?.toString("utf8");
    if (changed) {
      if (original) {
        backup = `${target}.remark-backup-${Date.now()}`;
        fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
      }
      fs.renameSync(staged, target);
    }
    try {
      const response = JSON.parse(execute("herdr", ["server", "reload-config"]));
      if (response.result?.status !== "applied")
        throw Error(`Config reload: ${JSON.stringify(response)}`);
    } catch (error) {
      if (changed) {
        if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== merged)
          throw Error(`Reload failed and config changed externally; left it untouched. Backup: ${backup || "none (new config)"}. ${error.message}`);
        if (original) fs.writeFileSync(target, original);
        else fs.unlinkSync(target);
      }
      throw Error(`Reload failed; previous config restored. The plugin remains linked. ${error.message}`);
    }
    execute(process.execPath, [path.join(ROOT, "src", "remark.js"), "init"]);
    return { target, backup, checked: false };
  } finally {
    if (fs.existsSync(staged)) fs.unlinkSync(staged);
  }
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== "--check")) throw Error("Usage: install [--check]");
    const result = install({ check: args.includes("--check") });
    console.log(`${result.checked ? "Config check passed" : "Remark installed and initialized"}: ${result.target}`);
    if (result.backup) console.log(`Config backup: ${result.backup}`);
    if (!result.checked) console.log(`Keep this linked checkout: ${ROOT}`);
  } catch (error) {
    console.error("remark install: " + error.message);
    process.exitCode = 1;
  }
}

module.exports = { configPath, mergeConfig, install };
