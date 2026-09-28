"use strict";

// Overlay pane: type a short remark for one agent pane.
//
// Launched by the `note` action with INFORM_TARGET_PANE in its env. Saving an
// empty line keeps the pane unread and drops the remark; Ctrl-C leaves
// everything untouched.

const readline = require("node:readline");
const a = require("./ansi");
const herdr = require("./herdr");
const state = require("./state");
const core = require("./core");

function line(s = "") {
  process.stdout.write(s + "\r\n");
}

function pause(ms = 1200) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const paneId = process.env.INFORM_TARGET_PANE || herdr.resolveTargetPane();
  if (!paneId) {
    line(`${a.red}没有目标 pane。${a.reset}`);
    await pause(2000);
    return;
  }

  const cfg = state.loadConfig();
  const label = process.env.INFORM_PANE_LABEL || paneId;
  const existing = process.env.INFORM_EXISTING_NOTE || "";

  process.stdout.write(a.clearScreen);
  line(`${a.bold}${a.cyan}备注${a.reset}  ${a.dim}${label}${a.reset}`);
  line(
    `${a.dim}回车保存并标未读 · 空行清除备注 · Ctrl-C 取消 · 最多 ${cfg.max_remark_width} 列${a.reset}`,
  );
  line();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  let cancelled = false;
  rl.on("SIGINT", () => {
    cancelled = true;
    rl.close();
  });

  const answer = await new Promise((resolve) => {
    let done = false;
    rl.question(`${a.yellow}> ${a.reset}`, (value) => {
      done = true;
      resolve(value);
    });
    if (existing) rl.write(existing);
    rl.on("close", () => {
      if (!done) resolve("");
    });
  });

  rl.close();

  if (cancelled) {
    line();
    line(`${a.dim}已取消，未改动${a.reset}`);
    await pause(700);
    return;
  }

  const note = core.sanitizeNote(answer);
  core.mark(paneId, { note, reason: "remark" });

  if (cfg.sort_unread_first) {
    try {
      await herdr.applyUnreadView();
    } catch {
      /* sorting is optional; tokens are already correct */
    }
  }

  line();
  if (note) {
    line(
      `${a.green}已标未读${a.reset} ${cfg.unread_marker} ${core.truncateToWidth(
        note,
        cfg.max_remark_width,
      )}`,
    );
  } else {
    line(`${a.green}已标未读${a.reset} ${a.dim}(无备注)${a.reset}`);
  }
  await pause(900);
}

main().catch(async (e) => {
  line(`${a.red}${e.message}${a.reset}`);
  await pause(2500);
});
