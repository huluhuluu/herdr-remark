"use strict";

// Thin Herdr access layer.
//
// Two transports:
//   cli()    - spawn HERDR_BIN_PATH. Portable, used for everything the CLI covers.
//   socket() - newline-delimited JSON over the local socket. Used only for
//              agent.view.set / agent.view.clear, which have no CLI wrapper.
//
// On Windows the socket is a named pipe whose name is the socket path appended
// to \\.\pipe\ — verified against herdr 0.8.2.

const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PLUGIN_ID = process.env.HERDR_PLUGIN_ID || "huluhlu.agent-inform";
const VIEW_SOURCE = `plugin:${PLUGIN_ID}`;
const METADATA_SOURCE = `plugin:${PLUGIN_ID}`;

function binPath() {
  return process.env.HERDR_BIN_PATH || "herdr";
}

function configDir() {
  if (process.env.APPDATA) return path.join(process.env.APPDATA, "herdr");
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return path.join(xdg, "herdr");
  return path.join(os.homedir(), ".config", "herdr");
}

function socketPath() {
  if (process.env.HERDR_SOCKET_PATH) return process.env.HERDR_SOCKET_PATH;
  const session = process.env.HERDR_SESSION;
  if (session) {
    return path.join(configDir(), "sessions", session, "herdr.sock");
  }
  return path.join(configDir(), "herdr.sock");
}

function socketTarget() {
  const sock = socketPath();
  if (process.platform !== "win32") return sock;
  if (sock.startsWith("\\\\.\\pipe\\")) return sock;
  return "\\\\.\\pipe\\" + sock;
}

/**
 * The plugin directory as a path Node can resolve against.
 *
 * Herdr canonicalises the plugin root, so on Windows HERDR_PLUGIN_ROOT arrives
 * in extended-length form (`\\?\D:\Code\herdr-inform`). Node refuses to resolve
 * a relative main script from such a cwd, so the prefix is stripped here and
 * handed back to Herdr as the pane cwd by openPane().
 */
function pluginRoot() {
  let root = process.env.HERDR_PLUGIN_ROOT || process.cwd();
  if (root.startsWith("\\\\?\\UNC\\")) return "\\\\" + root.slice(8);
  if (root.startsWith("\\\\?\\")) return root.slice(4);
  return root;
}

// --- CLI transport ---------------------------------------------------------

function cli(args, { check = true } = {}) {
  const res = spawnSync(binPath(), args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (res.error) {
    if (check) throw new Error(`herdr spawn failed: ${res.error.message}`);
    return null;
  }
  let parsed = null;
  const out = (res.stdout || "").trim();
  if (out) {
    try {
      parsed = JSON.parse(out);
    } catch {
      parsed = null;
    }
  }
  if (res.status !== 0 || (parsed && parsed.error)) {
    const detail =
      (parsed && parsed.error && (parsed.error.message || parsed.error.code)) ||
      (res.stderr || "").trim() ||
      `exit ${res.status}`;
    if (check) throw new Error(`herdr ${args[0]} failed: ${detail}`);
    return null;
  }
  return parsed;
}

// --- socket transport ------------------------------------------------------

function socketRequest(method, params, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const target = socketTarget();
    const id = `inform_${Date.now().toString(36)}`;
    const conn = net.connect({ path: target });
    let buf = "";
    let settled = false;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.destroy();
      if (err) reject(err);
      else resolve(value);
    };

    const timer = setTimeout(
      () => finish(new Error(`socket timeout on ${method}`)),
      timeoutMs,
    );

    conn.setEncoding("utf8");
    conn.on("connect", () => {
      conn.write(JSON.stringify({ id, method, params: params || {} }) + "\n");
    });
    conn.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id !== id) continue;
        if (msg.error) {
          finish(
            new Error(
              `${method}: ${msg.error.message || msg.error.code || "error"}`,
            ),
          );
          return;
        }
        finish(null, msg.result);
        return;
      }
    });
    conn.on("error", (e) => finish(new Error(`socket ${target}: ${e.message}`)));
    conn.on("close", () => finish(new Error(`socket closed before ${method}`)));
  });
}

// --- higher level helpers --------------------------------------------------

function listAgents() {
  const res = cli(["agent", "list"], { check: false });
  return (res && res.result && res.result.agents) || [];
}

function listPanes() {
  const res = cli(["pane", "list"], { check: false });
  return (res && res.result && res.result.panes) || [];
}

function currentPane() {
  const res = cli(["pane", "current"], { check: false });
  return (res && res.result && res.result.pane) || null;
}

/**
 * Patch display-only pane tokens. `tokens` maps name -> string, or null to clear.
 */
function reportTokens(paneId, tokens) {
  const args = ["pane", "report-metadata", paneId, "--source", METADATA_SOURCE];
  for (const [name, value] of Object.entries(tokens)) {
    if (value === null || value === undefined || value === "") {
      args.push("--clear-token", name);
    } else {
      args.push("--token", `${name}=${value}`);
    }
  }
  return cli(args, { check: false });
}

function notify(title, body, { sound = "request" } = {}) {
  const args = ["notification", "show", title];
  if (body) args.push("--body", body);
  if (sound) args.push("--sound", sound);
  return cli(args, { check: false });
}

/**
 * Focus a pane. `herdr pane focus` is directional only, so this goes over the
 * socket, which is the sole way to focus a pane by id.
 */
function focusPane(paneId) {
  return socketRequest("pane.focus", { pane_id: paneId });
}

/** Full PaneInfo, including the metadata tokens Herdr currently holds. */
function paneInfo(paneId) {
  const res = cli(["pane", "get", paneId], { check: false });
  return (res && res.result && res.result.pane) || null;
}

/**
 * Open one of this plugin's pane entrypoints.
 *
 * `--cwd` is always sent: pane commands in the manifest use relative script
 * paths, and Herdr's own default cwd for a plugin pane is the extended-length
 * plugin root, which Node cannot resolve a relative script against.
 */
function openPane(entrypoint, env = {}, extra = []) {
  const args = [
    "plugin",
    "pane",
    "open",
    "--plugin",
    PLUGIN_ID,
    "--entrypoint",
    entrypoint,
    "--cwd",
    pluginRoot(),
  ];
  for (const [k, v] of Object.entries(env)) {
    args.push("--env", `${k}=${v}`);
  }
  args.push(...extra);
  // Throws with Herdr's own message rather than returning null. A swallowed
  // failure here is indistinguishable from "the editor does nothing", which is
  // the single hardest symptom to diagnose in this plugin.
  const res = cli(args, { check: true });
  // Success without a JSON body still counts as opened.
  return res || {};
}

/**
 * Install the declarative Agents view that floats unread agents to the top.
 * Sorts on the plugin's own `unread` token, so it needs the socket API.
 */
async function applyUnreadView({ label = "unread first" } = {}) {
  return socketRequest("agent.view.set", {
    source: VIEW_SOURCE,
    label,
    sort: [
      { field: { token: "unread" }, order: "desc" },
      { field: "attention", order: "desc" },
      { field: "state_change_seq", order: "desc" },
    ],
  });
}

async function clearUnreadView() {
  return socketRequest("agent.view.clear", { source: VIEW_SOURCE });
}

function pluginContext() {
  const raw = process.env.HERDR_PLUGIN_CONTEXT_JSON;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Resolve which pane an action should act on: explicit env, plugin context,
 * then the focused pane.
 */
function resolveTargetPane() {
  if (process.env.INFORM_TARGET_PANE) return process.env.INFORM_TARGET_PANE;
  const ctx = pluginContext();
  if (ctx.focused_pane_id) return ctx.focused_pane_id;
  if (process.env.HERDR_PANE_ID) return process.env.HERDR_PANE_ID;
  const pane = currentPane();
  return pane ? pane.pane_id : null;
}

module.exports = {
  PLUGIN_ID,
  VIEW_SOURCE,
  METADATA_SOURCE,
  binPath,
  configDir,
  socketPath,
  socketTarget,
  pluginRoot,
  cli,
  socketRequest,
  listAgents,
  listPanes,
  currentPane,
  reportTokens,
  notify,
  focusPane,
  paneInfo,
  openPane,
  applyUnreadView,
  clearUnreadView,
  pluginContext,
  resolveTargetPane,
};
