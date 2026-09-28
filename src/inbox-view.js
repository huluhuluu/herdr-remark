"use strict";

// Overlay pane: the unread inbox, keyboard and mouse driven.
//
// Keyboard: j/k or arrows move, Enter jumps and clears, space toggles
// read/unread, e edits the remark, c clears one row, C clears everything,
// r refreshes, q or Esc closes.
//
// Mouse: Herdr 0.8.2 does not surface plugin actions in its own right-click
// menus, so the plugin owns mouse input inside its own pane instead. This
// enables SGR mouse reporting and asks Herdr to route right-clicks here
// (`pane input --right-click pane`), which gives per-row buttons, wheel
// scrolling, and a real right-click context menu.

const a = require("./ansi");
const herdr = require("./herdr");
const state = require("./state");
const core = require("./core");

const STATUS_COLOR = {
  blocked: a.red,
  done: a.green,
  working: a.yellow,
  idle: a.gray,
  unknown: a.gray,
};

const ROW_ACTIONS = [
  { id: "jump", label: "跳转" },
  { id: "toggle", label: "已读" },
  { id: "note", label: "备注" },
  { id: "clear", label: "清除" },
];

// An untracked agent has nothing to mark read or clear yet, so those buttons
// would be dead. Offer the two that do something instead.
const UNTRACKED_ROW_ACTIONS = [
  { id: "jump", label: "跳转" },
  { id: "toggle", label: "标未读" },
  { id: "note", label: "备注" },
];

function rowActions(row) {
  return row.tracked ? ROW_ACTIONS : UNTRACKED_ROW_ACTIONS;
}

const GLOBAL_ACTIONS = [
  { id: "toggle-all", label: "全部/未读" },
  { id: "refresh", label: "刷新" },
  { id: "clear-all", label: "全清" },
  { id: "quit", label: "关闭" },
];

const MENU_ITEMS = [
  { id: "jump", label: "跳转过去" },
  { id: "toggle", label: "切换未读" },
  { id: "note", label: "编辑备注" },
  { id: "clear", label: "清除本条" },
  { id: "clear-all", label: "全部清除" },
];

let rows = [];
let cursor = 0;
let flash = "";
let hits = []; // clickable regions in the base view
let menuHits = []; // clickable regions in the open context menu
let lineRow = new Map(); // 1-based screen line -> inbox row index
let menu = null; // { row, col, index, sel }
let showAll = false; // false: unread only. true: every live agent.
// Inline remark editor: { paneId, label, chars }. Editing happens in this pane
// rather than by handing off to note-editor, so it cannot fail on pane spawning.
let edit = null;

function out(s) {
  process.stdout.write(s);
}

/**
 * Rebuild the row list, keeping the cursor on the same pane where possible.
 *
 * Two modes, because Herdr gives plugins no way to act on the agent highlighted
 * in its own sidebar: the plugin context carries only the *focused* pane. The
 * all-agents mode is this plugin's stand-in for that missing entry point — it is
 * the only place you can flag an agent you are not currently looking at.
 */
function refresh() {
  const keep = rows[cursor] && rows[cursor].pane_id;
  rows = showAll ? core.allAgents() : core.inbox();
  const at = keep ? rows.findIndex((r) => r.pane_id === keep) : -1;
  cursor = at >= 0 ? at : Math.min(cursor, Math.max(0, rows.length - 1));
}

function when(ts) {
  if (!ts) return "-";
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

function rule(width) {
  return `${a.gray}${"─".repeat(Math.max(10, Math.min(width - 1, 100)))}${a.reset}`;
}

function findHit(list, row, col) {
  return list.find((h) => h.line === row && col >= h.from && col <= h.to) || null;
}

function render() {
  const cfg = state.loadConfig();
  const width = process.stdout.columns || 80;
  const lines = [];
  hits = [];
  lineRow = new Map();

  // Returns the 1-based screen line the text landed on, so hit regions and
  // row lookups are recorded from the same source as the drawing.
  const push = (s) => lines.push(s);

  const buttons = (actions, index, indent) => {
    const line = lines.length + 1;
    let col = indent + 1;
    const parts = [];
    for (const act of actions) {
      const text = `[${act.label}]`;
      const w = core.displayWidth(text);
      hits.push({ line, from: col, to: col + w - 1, action: act.id, index });
      parts.push(`${a.blue}${text}${a.reset}`);
      col += w + 1;
    }
    push(" ".repeat(indent) + parts.join(" "));
    return line;
  };

  const unread = rows.filter((r) => r.unread).length;
  const title = showAll ? "全部 agent" : "未读收件箱";
  push(
    `${a.bold}${a.cyan}${title}${a.reset}  ${a.dim}${unread} 未读 / ${rows.length} 条${a.reset}` +
      `  ${a.gray}tab 切换${showAll ? "仅未读" : "全部"}${a.reset}`,
  );
  push(rule(width));

  if (!rows.length) {
    push("");
    push(
      `  ${a.dim}${showAll ? "没有正在运行的 agent。" : "没有未读的 agent。按 tab 看全部。"}${a.reset}`,
    );
  }

  rows.forEach((r, i) => {
    const sel = i === cursor;
    const mark = r.unread ? cfg.unread_marker || "●" : " ";
    const statusColor = STATUS_COLOR[r.status] || a.gray;
    const dead = r.alive ? "" : ` ${a.red}(pane 已关闭)${a.reset}`;
    const here = r.focused ? ` ${a.cyan}← 当前${a.reset}` : "";
    const head = `${mark} ${r.agent} ${a.dim}${r.pane_id}${a.reset} ${statusColor}${r.status}${a.reset}`;
    lineRow.set(push(`${sel ? a.reverse : ""}${head}${a.reset}${dead}${here}`), i);

    const detail = r.note
      ? `${a.yellow}${core.truncateToWidth(r.note, Math.max(20, width - 8))}${a.reset}`
      : `${a.dim}(无备注)${a.reset}`;
    lineRow.set(push(`    ${detail}`), i);

    const title = r.title || r.cwd || "";
    if (title) {
      lineRow.set(
        push(`    ${a.dim}${core.truncateToWidth(title, Math.max(20, width - 8))}${a.reset}`),
        i,
      );
    }
    const meta = r.tracked
      ? `${when(r.marked_at)} · ${r.reason || "manual"}`
      : "未标记";
    lineRow.set(push(`    ${a.gray}${meta}${a.reset}`), i);
    lineRow.set(buttons(rowActions(r), i, 4), i);
    push("");
  });

  push(rule(width));

  if (edit) {
    const text = edit.chars.join("");
    push(`${a.bold}${a.cyan}备注${a.reset} ${a.dim}${edit.label}${a.reset}`);
    push(
      `${a.yellow}> ${a.reset}${text}${a.reverse} ${a.reset}` +
        `  ${a.dim}${core.displayWidth(text)}/${cfg.max_remark_width}${a.reset}`,
    );
    push(`${a.dim}回车保存并标未读 · 空行清除备注 · Esc 取消${a.reset}`);
    out(a.clearScreen + a.hideCursor + lines.join("\r\n") + "\r\n");
    return;
  }

  buttons(GLOBAL_ACTIONS, -1, 0);
  push(
    `${a.dim}j/k 移动 · Enter 跳转 · space 标未读/已读 · e 编辑备注 · c 清除 · tab 全部/未读${a.reset}`,
  );
  push(`${a.dim}C 全清 · r 刷新 · m 菜单 · q 退出 · 鼠标：左键点行或按钮 · 右键出菜单 · 滚轮移动${a.reset}`);
  if (flash) {
    push(`${a.green}${flash}${a.reset}`);
    flash = "";
  }

  out(a.clearScreen + a.hideCursor + lines.join("\r\n") + "\r\n");
  renderMenu();
}

/** Draw the right-click menu on top of the rendered view, clamped to the pane. */
function renderMenu() {
  menuHits = [];
  if (!menu) return;

  const labelWidth = Math.max(...MENU_ITEMS.map((m) => core.displayWidth(m.label)));
  const boxWidth = labelWidth + 4;
  const boxHeight = MENU_ITEMS.length + 2;
  const maxRow = process.stdout.rows || 24;
  const maxCol = process.stdout.columns || 80;
  const row = Math.max(1, Math.min(menu.row, maxRow - boxHeight + 1));
  const col = Math.max(1, Math.min(menu.col, maxCol - boxWidth + 1));

  out(a.to(row, col) + `${a.cyan}┌${"─".repeat(boxWidth - 2)}┐${a.reset}`);
  MENU_ITEMS.forEach((m, i) => {
    const pad = " ".repeat(boxWidth - 4 - core.displayWidth(m.label));
    const body = `${m.label}${pad}`;
    const line = row + 1 + i;
    out(
      a.to(line, col) +
        `${a.cyan}│${a.reset}${i === menu.sel ? a.reverse : ""} ${body} ${a.reset}${a.cyan}│${a.reset}`,
    );
    menuHits.push({
      line,
      from: col + 1,
      to: col + boxWidth - 2,
      action: m.id,
      index: menu.index,
    });
  });
  out(a.to(row + boxHeight - 1, col) + `${a.cyan}└${"─".repeat(boxWidth - 2)}┘${a.reset}`);
}

async function reapplyView() {
  const cfg = state.loadConfig();
  if (!cfg.sort_unread_first) return;
  try {
    await herdr.applyUnreadView();
  } catch {
    /* sidebar ordering is optional; tokens are already correct */
  }
}

/**
 * Hand off to the remark editor. Returns false if it could not be opened, in
 * which case the caller must stay open — quitting on a failed handoff loses both
 * panes and looks exactly like "editing a remark does nothing".
 */
function openNoteEditor(row) {
  const existing = state.getPane(state.readState(), row.pane_id);
  try {
    herdr.openPane(
      "note-editor",
      {
        INFORM_TARGET_PANE: row.pane_id,
        INFORM_EXISTING_NOTE: (existing && existing.note) || "",
        INFORM_PANE_LABEL: `${row.agent} · ${row.title || row.pane_id}`,
      },
      ["--focus"],
    );
    return true;
  } catch (e) {
    flash = `打不开备注编辑器: ${e.message}`;
    return false;
  }
}

function quit(code = 0) {
  // No need to restore right-click routing: this pane is about to be destroyed.
  out(a.mouseOff + a.showCursor + a.reset + "\r\n");
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.exit(code);
}

/** Ask Herdr to send right-clicks to this pane instead of opening its own menu. */
function claimRightClick() {
  const paneId = process.env.HERDR_PANE_ID;
  if (!paneId) return;
  herdr.cli(["pane", "input", paneId, "--right-click", "pane"], { check: false });
}

/** Single dispatch point, so a keypress and a click do exactly the same thing. */
async function runAction(id, index = -1) {
  if (id === "quit") return quit();
  if (id === "refresh") {
    refresh();
    flash = "已刷新";
    return render();
  }
  if (id === "clear-all") {
    const n = core.clearAll();
    await reapplyView();
    refresh();
    flash = `已清除 ${n} 条`;
    return render();
  }
  if (id === "toggle-all") {
    showAll = !showAll;
    refresh();
    flash = showAll ? "显示全部 agent" : "只显示未读";
    return render();
  }

  if (index >= 0) cursor = index;
  const cur = rows[cursor];
  if (!cur) return render();

  if (id === "select") return render();
  if (id === "jump") {
    if (!cur.alive) {
      flash = "pane 已关闭，无法跳转";
      return render();
    }
    // Mark read rather than clear: the remark is the reason you came here, and
    // throwing it away on arrival is exactly the behaviour that made the
    // sidebar mark useless. Use 清除 when you are actually done with it.
    if (cur.tracked) {
      core.markRead(cur.pane_id);
      await reapplyView();
    }
    // Must complete before quit(): process.exit would drop the socket write.
    try {
      await herdr.focusPane(cur.pane_id);
    } catch (e) {
      out(`${a.red}无法跳转: ${e.message}${a.reset}\r\n`);
    }
    return quit();
  }
  if (id === "toggle") {
    const { marked } = core.toggle(cur.pane_id);
    await reapplyView();
    refresh();
    flash = marked ? "已标未读" : "已标已读";
    return render();
  }
  if (id === "clear") {
    if (!cur.tracked) {
      flash = "这条还没标记过";
      return render();
    }
    core.clear(cur.pane_id);
    await reapplyView();
    refresh();
    flash = "已清除该条";
    return render();
  }
  if (id === "note") {
    // Inline, not a handoff to note-editor: one less pane spawn to fail, and the
    // cursor is still on this row when you come back.
    const existing = state.getPane(state.readState(), cur.pane_id);
    edit = {
      paneId: cur.pane_id,
      label: `${cur.agent} · ${cur.title || cur.pane_id}`,
      chars: Array.from((existing && existing.note) || ""),
    };
    menu = null;
    return render();
  }
  return render();
}

function move(delta) {
  if (rows.length) cursor = (cursor + delta + rows.length) % rows.length;
}

async function handleMouse(ev) {
  // The inline editor owns the keyboard; a stray click must not move the cursor
  // out from under the remark being typed.
  if (edit) return;
  if (ev.btn & 64) {
    if (!ev.press) return;
    move((ev.btn & 3) === 0 ? -1 : 1);
    menu = null;
    return render();
  }
  if (!ev.press) return; // act on press; ignore the matching release
  const button = ev.btn & 3;

  if (menu) {
    const hit = findHit(menuHits, ev.row, ev.col);
    menu = null;
    if (hit && button === 0) return runAction(hit.action, hit.index);
    return render(); // a click anywhere else just dismisses the menu
  }

  if (button === 2) {
    const index = lineRow.get(ev.row);
    if (index === undefined) return render();
    cursor = index;
    menu = { row: ev.row + 1, col: ev.col, index, sel: 0 };
    return render();
  }

  if (button === 0) {
    const hit = findHit(hits, ev.row, ev.col);
    if (hit) return runAction(hit.action, hit.index);
    const index = lineRow.get(ev.row);
    if (index !== undefined) return runAction("select", index);
  }
}

const KEY = {
  ctrlC: "\x03",
  esc: "\x1b",
  enter: "\r",
  up: "\x1b[A",
  down: "\x1b[B",
};

/** Keys while the inline remark editor is open. Swallows everything else. */
async function handleEditKey(key) {
  if (key === KEY.esc || key === KEY.ctrlC) {
    edit = null;
    flash = "已取消，未改动";
    return render();
  }
  if (key === KEY.enter || key === "\n") {
    const { paneId } = edit;
    const note = core.sanitizeNote(edit.chars.join(""));
    edit = null;
    core.mark(paneId, { note, reason: "remark" });
    await reapplyView();
    refresh();
    const at = rows.findIndex((r) => r.pane_id === paneId);
    if (at >= 0) cursor = at;
    flash = note ? `已保存备注：${note}` : "已清除备注，仍为未读";
    return render();
  }
  if (key === "\x7f" || key === "\b") {
    edit.chars.pop();
    return render();
  }
  // Printable only: control bytes and stray escape leftovers must not land in
  // the remark.
  if (key >= " " && key !== "\x7f") edit.chars.push(key);
  return render();
}

async function handleKey(key) {
  if (edit) return handleEditKey(key);
  if (menu) {
    if (key === "j" || key === KEY.down) {
      menu.sel = (menu.sel + 1) % MENU_ITEMS.length;
      return render();
    }
    if (key === "k" || key === KEY.up) {
      menu.sel = (menu.sel - 1 + MENU_ITEMS.length) % MENU_ITEMS.length;
      return render();
    }
    if (key === KEY.enter || key === "\n") {
      const item = MENU_ITEMS[menu.sel];
      const index = menu.index;
      menu = null;
      return runAction(item.id, index);
    }
    if (key === KEY.esc || key === "q" || key === KEY.ctrlC) {
      menu = null;
      return render();
    }
    return render();
  }

  if (key === KEY.ctrlC || key === "q" || key === KEY.esc) return quit();
  if (key === "j" || key === KEY.down) {
    move(1);
    return render();
  }
  if (key === "k" || key === KEY.up) {
    move(-1);
    return render();
  }
  if (key === "r") return runAction("refresh");
  if (key === "C") return runAction("clear-all");
  if (key === "\t" || key === "A" || key === "a") return runAction("toggle-all");
  if (key === KEY.enter || key === "\n") return runAction("jump");
  if (key === " ") return runAction("toggle");
  if (key === "c") return runAction("clear");
  if (key === "e") return runAction("note");
  if (key === "m") {
    // Keyboard route to the same context menu, for people who never reach for
    // the mouse but want the menu's labels.
    if (rows.length) menu = { row: 3, col: 6, index: cursor, sel: 0 };
    return render();
  }
  return render();
}

// --- input decoding --------------------------------------------------------

let inbuf = "";
let escTimer = null;
const queue = [];
let busy = false;

// A buffer that is still a valid prefix of a longer escape sequence: wait for
// the rest instead of mis-reading the ESC as a keypress.
const PARTIAL = /^\x1b(\[[0-9;<]*)?$/;
const MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
const ARROW = /^\x1b\[([A-Za-z])/;
const CSI_ANY = /^\x1b\[[0-9;?]*[A-Za-z~]/;

function nextToken() {
  if (!inbuf || PARTIAL.test(inbuf)) return null;

  const m = MOUSE.exec(inbuf);
  if (m) {
    inbuf = inbuf.slice(m[0].length);
    return {
      type: "mouse",
      btn: Number(m[1]),
      col: Number(m[2]),
      row: Number(m[3]),
      press: m[4] === "M",
    };
  }
  const arrow = ARROW.exec(inbuf);
  if (arrow) {
    inbuf = inbuf.slice(arrow[0].length);
    return { type: "key", key: `\x1b[${arrow[1]}` };
  }
  const other = CSI_ANY.exec(inbuf);
  if (other) {
    inbuf = inbuf.slice(other[0].length);
    return { type: "ignore" };
  }
  if (inbuf[0] === "\x1b") {
    inbuf = inbuf.slice(1);
    return { type: "key", key: KEY.esc };
  }
  // A whole code point, not a code unit: the inline remark editor buffers these
  // verbatim, and half a surrogate pair would corrupt the note.
  const cp = String.fromCodePoint(inbuf.codePointAt(0));
  inbuf = inbuf.slice(cp.length);
  return { type: "key", key: cp };
}

/** Run one token at a time: a burst of clicks must not interleave renders. */
function pump() {
  if (busy) return;
  const tok = queue.shift();
  if (!tok) return;
  busy = true;
  const done = () => {
    busy = false;
    pump();
  };
  const run = tok.type === "mouse" ? handleMouse(tok) : handleKey(tok.key);
  Promise.resolve(run).then(done, (e) => {
    out(`${a.red}${e.message}${a.reset}\r\n`);
    done();
  });
}

function scheduleEscFlush() {
  if (escTimer) {
    clearTimeout(escTimer);
    escTimer = null;
  }
  if (inbuf !== "\x1b") return;
  // A bare ESC is ambiguous: the Esc key, or a sequence still in flight.
  escTimer = setTimeout(() => {
    escTimer = null;
    if (inbuf !== "\x1b") return;
    inbuf = "";
    queue.push({ type: "key", key: KEY.esc });
    pump();
  }, 40);
}

function drain() {
  for (;;) {
    const tok = nextToken();
    if (!tok) break;
    if (tok.type !== "ignore") queue.push(tok);
  }
  scheduleEscFlush();
  pump();
}

function main() {
  state.writeDefaultConfigIfMissing();
  claimRightClick();
  // INFORM_SHOW_ALL lets the `agents` action open straight into the full list.
  showAll = process.env.INFORM_SHOW_ALL === "1";
  refresh();
  // An empty unread list is a dead end; start in the full list instead so there
  // is always something to act on.
  if (!showAll && !rows.length) {
    showAll = true;
    refresh();
  }

  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  out(a.mouseOn);
  render();

  process.stdin.on("data", (chunk) => {
    inbuf += chunk;
    drain();
  });
  process.stdout.on("resize", () => {
    if (!busy) render();
  });
  process.on("exit", () => out(a.mouseOff + a.showCursor));
  process.on("SIGINT", () => quit());
}

main();
