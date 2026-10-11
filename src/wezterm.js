"use strict";

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const os = require("node:os");
const path = require("node:path");
const run = promisify(execFile);

// Match two different visible rows at one origin, as in the UIA adapter.
// JS string length is not a terminal column count. ASCII is one cell; other
// codepoints contribute 0..2 cells, so custom Unicode widths need no table.
function origin(text, anchors, height, rows, cols) {
  const matches = new Map();
  String(text).split(/\r?\n/).slice(0, rows).forEach((line, row) => {
    for (const anchor of anchors) {
      const top = row - anchor.row;
      if (top < 0 || top + height > rows) continue;
      let start = 0, index;
      while ((index = line.indexOf(anchor.text, start)) !== -1) {
        const prefix = line.slice(0, index);
        let min = 0, max = 0;
        for (const character of prefix) {
          if (/[\x00-\x1f\x7f]/.test(character)) { min = cols; break; }
          if (/[ -~]/.test(character)) { min++; max++; } else { max += 2; }
        }
        for (let col = min; col <= Math.min(max, cols - 1); col++) {
          const key = `${top},${col}`;
          const match = matches.get(key) || { row: top, col, rows: new Set() };
          match.rows.add(anchor.row);
          matches.set(key, match);
        }
        start = index + 1;
      }
    }
  });
  const found = [...matches.values()].filter(item => item.rows.size >= 2).sort((a, b) => a.col - b.col);
  if (!found.length || found.some(item => item.row !== found[0].row) ||
      found.at(-1).col - found[0].col + 1 !== found.length) return;
  return { row: found[0].row, min: found[0].col, max: found.at(-1).col };
}

function bounds(request, pane, panes, text) {
  const client = request.host.client;
  const size = pane.size;
  if (!client || !size?.cols || !size.rows || !size.pixel_width || !size.pixel_height) return;
  const found = origin(text, request.anchors, request.height, size.rows, size.cols);
  if (!found) return;
  const tab = pane.is_zoomed ? [pane] : panes.filter(item => item.tab_id === pane.tab_id);
  const left = pane.is_zoomed ? 0 : pane.left_col;
  const top = pane.is_zoomed ? 0 : pane.top_row;
  const cols = pane.is_zoomed ? size.cols : Math.max(...tab.map(item => item.left_col + item.size.cols));
  const rows = pane.is_zoomed ? size.rows : Math.max(...tab.map(item => item.top_row + item.size.rows));
  const cw = size.pixel_width / size.cols, ch = size.pixel_height / size.rows;
  const paddingX = client.Right - client.Left - cols * cw;
  const paddingY = client.Bottom - client.Top - rows * ch;
  if (paddingX < 0 || paddingY < 0 || found.min + request.width > size.cols) return;
  // The CLI does not expose padding/tab-bar placement. Intersect every
  // possible grid placement inside the client area; edges may be excluded,
  // but custom padding never requires guessed offsets or config changes.
  const result = {
    left: client.Left + paddingX + (left + found.max) * cw,
    right: client.Left + (left + found.min + request.width) * cw,
    top: client.Top + paddingY + (top + found.row) * ch,
    bottom: client.Top + (top + found.row + request.height) * ch,
  };
  if (Object.values(result).every(Number.isFinite) &&
      request.x >= result.left && request.x < result.right &&
      request.y >= result.top && request.y < result.bottom) return result;
}

async function verify(request, env = process.env, execute = run) {
  // Use the CLI adjacent to the event's GUI, including portable installs.
  // An inherited socket selects the launching instance; otherwise --class
  // uses WezTerm's public discovery. A PID mismatch is never accepted.
  const cli = async args => (await execute(request.host.executable,
    ["cli", "--no-auto-start", "--class", request.host.class, ...args], {
      env, windowsHide: true, timeout: 1000, maxBuffer: 2 * 1024 * 1024,
      // Windows GUI discovery publishes a relative socket name (including
      // 20240203). Run in WezTerm's runtime directory, never create one.
      cwd: path.join(os.homedir(), ".local", "share", "wezterm"),
      encoding: "utf8",
    })).stdout;
  const json = async command => JSON.parse(await cli([command, "--format", "json"]));
  const focus = clients => clients.find(item => item.pid === request.process)?.focused_pane_id;
  try {
    const [clients, panes] = await Promise.all([json("list-clients"), json("list")]);
    const id = focus(clients);
    const pane = panes.find(item => item.pane_id === id && item.is_active);
    if (!pane) return;
    const text = await cli(["get-text", "--pane-id", String(id), "--start-line", "0",
      "--end-line", String(pane.size.rows)]);
    const area = bounds(request, pane, panes, text);
    if (area && focus(await json("list-clients")) === id) return area;
  } catch {
    // Missing/old CLI, closed GUI and unsupported mux connections leave the
    // mark unread without stopping other hosts or logging conversation text.
  }
}

module.exports = { origin, bounds, verify };
