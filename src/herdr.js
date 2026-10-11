"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Keep the installed id so existing keybindings and linked installs still work.
const ID = process.env.HERDR_PLUGIN_ID || "huluhlu.agent-inform";

// CLI and socket writers stamp the same clock before reading their snapshots.
const sequence = () => Number(process.hrtime.bigint());

function cli(args) {
  const bin = process.env.HERDR_BIN_PATH || "herdr";
  const res = spawnSync(bin, args, {
    encoding: "utf8", windowsHide: true, timeout: 10000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  // A missing binary reports no status and empty output, so name the real
  // problem instead of surfacing a raw ENOENT or a later, unrelated error.
  if (res.error?.code === "ENOENT")
    throw new Error(`找不到 herdr 可执行文件（${bin}）。请将 herdr 加入 PATH，或设置 HERDR_BIN_PATH。`);
  if (res.error?.code === "ETIMEDOUT")
    throw new Error(`herdr 未在超时时间内响应：${args[0]} ${args[1] || ""}`.trim());
  let body;
  try { body = JSON.parse((res.stdout || res.stderr || "").trim()); } catch {}
  if (res.error || res.status !== 0 || body?.error) {
    const error = new Error(res.error?.message || body?.error?.message ||
      (res.stderr || "").trim() || 'herdr exited with ' + res.status);
    error.code = body?.error?.code || res.error?.code;
    throw error;
  }
  return body?.result || {};
}

function envJson(name) {
  const raw = process.env[name];
  try { return JSON.parse(raw || "{}"); } catch {
    throw new Error(`${name} 不是合法的 JSON：${String(raw).slice(0, 200)}`);
  }
}

function target() {
  const context = envJson("HERDR_PLUGIN_CONTEXT_JSON");
  const id = context.focused_pane_id || process.env.HERDR_PANE_ID;
  const pane = id ? cli(["pane", "get", id]).pane : cli(["pane", "current"]).pane;
  if (!pane?.agent) throw new Error("请先聚焦一个 Agent。");
  return pane;
}

function paneForTerminal(terminalId) {
  const pane = cli(["pane", "list"]).panes?.find(p => p.terminal_id === terminalId);
  if (!pane) throw new Error("目标 Agent 已关闭，未保存备注。");
  return pane;
}

function branch(cwd) {
  if (!cwd) return "";
  const result = spawnSync("git", ["-C", cwd, "symbolic-ref", "--quiet", "--short", "HEAD"], {
    encoding: "utf8", windowsHide: true, timeout: 3000, stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? result.stdout.trim() : "";
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

module.exports = { ID, sequence, cli, envJson, target, paneForTerminal, branch, openEditor };
