"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Keep the installed id so existing keybindings and linked installs still work.
const ID = process.env.HERDR_PLUGIN_ID || "huluhlu.agent-inform";

function cli(args) {
  const res = spawnSync(process.env.HERDR_BIN_PATH || "herdr", args, {
    encoding: "utf8", windowsHide: true, timeout: 10000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let body;
  try { body = JSON.parse((res.stdout || res.stderr || "").trim()); } catch {}
  if (res.error || res.status !== 0 || body?.error) {
    throw new Error(res.error?.message || body?.error?.message ||
      (res.stderr || "").trim() || 'herdr exited with ' + res.status);
  }
  return body?.result || {};
}

function target() {
  const context = JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON || "{}");
  const id = process.env.INFORM_TARGET_PANE || context.focused_pane_id ||
    process.env.HERDR_PANE_ID;
  const pane = id ? cli(["pane", "get", id]).pane : cli(["pane", "current"]).pane;
  if (!pane?.agent) throw new Error("请先聚焦一个 Agent。");
  return pane;
}

function paneForTerminal(terminalId) {
  const pane = cli(["pane", "list"]).panes?.find(p => p.terminal_id === terminalId);
  if (!pane) throw new Error("目标 Agent 已关闭，未保存备注。");
  return pane;
}

function openEditor(pane, initial) {
  let root = path.resolve(__dirname, "..");
  if (root.startsWith("\\\\?\\UNC\\")) root = "\\\\" + root.slice(8);
  else if (root.startsWith("\\\\?\\")) root = root.slice(4);
  return cli([
    "plugin", "pane", "open", "--plugin", ID, "--entrypoint", "note-editor",
    "--cwd", root, "--focus",
    "--env", "REMARK_TERMINAL=" + pane.terminal_id,
    "--env", "REMARK_INITIAL=" + initial,
  ]);
}

module.exports = { ID, cli, target, paneForTerminal, openEditor };
