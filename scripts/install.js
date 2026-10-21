"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TextDecoder } = require("node:util");
const { spawnSync } = require("node:child_process");
const { ROOT, PLUGIN_ID, MIN_HERDR_VERSION, NODE_REQUIREMENT, versionAtLeast } = require("../src/plugin");
const BEGIN = "# herdr-remark begin";
const END = "# herdr-remark end";

// Keep line positions while hiding multiline string bodies. Markers and table
// names in shell command text are data, not editable TOML structure.
function codeLines(text) {
  let multiline;
  return text.split("\n").map(line => {
    const inside = !!multiline;
    if (!inside && /^\s*(?:key|"key"|'key')\s*=\s*(?:"""|''')/.test(line))
      throw Error("Multiline shortcut strings require a manual config merge.");
    let quote;
    for (let i = 0; i < line.length; i++) {
      const character = line[i];
      if (multiline) {
        if (multiline === '"""' && character === "\\") { i++; continue; }
        if (line.startsWith(multiline, i)) {
          const endQuote = multiline[0];
          while (line[i + 1] === endQuote) i++;
          multiline = undefined;
        }
      } else if (quote) {
        if (quote === '"' && character === "\\") i++;
        else if (character === quote) quote = undefined;
      } else if (character === "#") break;
      else if (line.startsWith('"""', i) || line.startsWith("'''", i)) {
        multiline = line.slice(i, i + 3);
        i += 2;
      } else if (character === '"' || character === "'") quote = character;
    }
    return inside || multiline ? "" : line;
  });
}

function basicString(value) {
  const escapes = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };
  return value.replace(/\\(?:u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8})|(["\\bfnrt]))/g,
    (_, short, long, escape) => escape ? escapes[escape] : String.fromCodePoint(parseInt(short || long, 16)));
}

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
  const visible = codeLines(text);
  const starts = visible.flatMap((line, i) => line.trim() === BEGIN ? [i] : []);
  const ends = visible.flatMap((line, i) => line.trim() === END ? [i] : []);
  if (starts.length > 1 || ends.length !== starts.length || ends[0] < starts[0])
    throw Error("Invalid Remark config markers; fix the begin/end block before installing.");
  const outside = starts.length ? [...lines.slice(0, starts[0]), ...lines.slice(ends[0] + 1)].join("\n") : text;
  const unmanaged = codeLines(outside).join("\n");
  const strings = (content, key) => [...content.matchAll(/^\s*(?:([a-zA-Z_]+)|"([^"]+)"|'([^']+)')\s*=\s*(?:"((?:[^"\\\r\n]|\\.)*)"|'([^'\r\n]*)')/gm)]
    .filter(match => (match[1] || (match[2] && basicString(match[2])) || match[3]) === key)
    .map(match => match[5] ?? basicString(match[4]));
  const keys = new Set(strings(codeLines(example).join("\n"), "key").map(key => key.trim().toLowerCase()));
  // Reject conflicting unmanaged settings instead of parsing/reformatting user TOML.
  if (/^\s*\[\s*ui\s*\.\s*sidebar\s*\.\s*agents(?:\s*\]|\s*\.)/m.test(unmanaged) ||
      strings(unmanaged, "key").some(key => keys.has(key.trim().toLowerCase())) ||
      strings(unmanaged, "command").some(command => command.startsWith(PLUGIN_ID + "."))) {
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

function install({ target = configPath(), check = false, execute = run, bin = process.env.HERDR_BIN_PATH || "herdr" } = {}) {
  if (!versionAtLeast(process.versions.node, NODE_REQUIREMENT)) throw Error(`Node.js ${NODE_REQUIREMENT} is required.`);
  execute("git", ["--version"]);
  if (!versionAtLeast(execute(bin, ["--version"]), MIN_HERDR_VERSION))
    throw Error(`Herdr ${MIN_HERDR_VERSION}+ is required.`);
  target = fs.existsSync(target) ? fs.realpathSync(target) : path.resolve(target);
  const original = fs.existsSync(target) ? fs.readFileSync(target) : null;
  let current = "";
  try {
    if (original) current = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(original);
  } catch { throw Error("Config must be UTF-8 TOML."); }
  const merged = mergeConfig(current, fs.readFileSync(path.join(ROOT, "config.example.toml"), "utf8"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const staged = `${target}.remark-check-${process.pid}.toml`;
  let backup;
  let warning;
  fs.writeFileSync(staged, merged, { flag: "wx", mode: original ? fs.statSync(target).mode & 0o777 : 0o600 });
  try {
    execute(bin, ["config", "check"], { HERDR_CONFIG_PATH: staged });
    if (check) return { target, checked: true };
    // Linking needs a running Herdr session. Failure here leaves the config intact.
    execute(bin, ["plugin", "link", ROOT]);
    const latest = fs.existsSync(target) ? fs.readFileSync(target) : null;
    if (original ? !latest?.equals(original) : latest !== null)
      throw Error("Config changed during installation; rerun the installer.");
    const changed = merged !== original?.toString("utf8");
    if (changed) {
      if (original) {
        backup = `${target}.remark-backup-${Date.now()}`;
        fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
      }
      fs.renameSync(staged, target);
    }
    const reload = () => {
      const response = JSON.parse(execute(bin, ["server", "reload-config"]));
      if (response.result?.status !== "applied")
        throw Error(`Config reload: ${JSON.stringify(response)}`);
    };
    try { reload(); }
    catch (error) {
      if (changed) {
        if (!fs.existsSync(target) || !fs.readFileSync(target).equals(Buffer.from(merged, "utf8")))
          throw Error(`Reload failed and config changed externally; left it untouched. Backup: ${backup || "none (new config)"}. ${error.message}`);
        if (original) fs.writeFileSync(target, original);
        else fs.unlinkSync(target);
        // A partial response or interrupted reply may have applied settings.
        // Restore the running server too, without replacing external edits.
        try { reload(); }
        catch (rollback) {
          throw Error(`Reload failed; previous config restored on disk, but runtime reload failed (${rollback.message}). The plugin remains linked. Rerun: ${bin} server reload-config. ${error.message}`);
        }
      }
      throw Error(`Reload failed; previous config restored. The plugin remains linked. ${error.message}`);
    }
    // The config is written and the plugin is linked at this point, so a failed
    // initialization must not read as a failed install: report it as a warning
    // and tell the user what to rerun, instead of leaving them to reinstall.
    try {
      execute(process.execPath, [path.join(ROOT, "src", "remark.js"), "reload"]);
      warning = undefined;
    } catch (error) {
      warning = `Installed and linked, but sidebar initialization failed (${error.message}). Rerun: npm run init`;
    }
    return { target, backup, checked: false, warning };
  } finally {
    if (fs.existsSync(staged)) fs.unlinkSync(staged);
  }
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== "--check")) throw Error("Usage: install [--check]");
    const result = install({ check: args.includes("--check") });
    const what = result.checked ? "Config check passed"
      : result.warning ? "Remark installed and linked" : "Remark installed and initialized";
    console.log(`${what}: ${result.target}`);
    if (result.backup) console.log(`Config backup: ${result.backup}`);
    if (result.warning) console.warn(`Warning: ${result.warning}`);
    if (!result.checked) console.log(`Keep this linked checkout: ${ROOT}`);
  } catch (error) {
    console.error("remark install: " + error.message);
    process.exitCode = 1;
  }
}

module.exports = { configPath, mergeConfig, install };
