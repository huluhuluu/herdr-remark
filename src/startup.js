"use strict";

// Startup hook.
//
// Pane tokens do not survive a cold server restart, so state.json is the source
// of truth and this re-projects it: re-report every stored token and re-install
// the Agents view. Waits briefly for pane restoration first, otherwise there is
// nothing to attach tokens to.

const herdr = require("./herdr");
const state = require("./state");
const core = require("./core");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForPanes({ tries = 12, waitMs = 250 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    if (herdr.listPanes().length) return true;
    await sleep(waitMs);
  }
  return false;
}

async function main() {
  state.writeDefaultConfigIfMissing();
  const cfg = state.loadConfig();

  const stored = Object.keys(state.readState().panes).length;
  if (stored) await waitForPanes();

  const { restored, dropped } = core.resync();

  if (cfg.sort_unread_first) {
    try {
      await herdr.applyUnreadView();
    } catch (e) {
      process.stderr.write(`agent-inform: view not applied (${e.message})\n`);
    }
  }

  process.stdout.write(
    `agent-inform: restored ${restored} pane(s), dropped ${dropped}\n`,
  );
}

main().catch((e) => {
  process.stderr.write(`agent-inform startup: ${e.message}\n`);
  process.exit(0);
});
