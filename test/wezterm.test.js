"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const wezterm = require("../src/wezterm");

const anchors = [{ row: 0, text: "Completed the requested changes" },
  { row: 1, text: "All existing checks have passed" }];
const pane = { pane_id: 0, tab_id: 2, window_id: 1, left_col: 0, top_row: 0,
  is_active: true, is_zoomed: false, size: { cols: 80, rows: 24, pixel_width: 640, pixel_height: 384 } };
const request = { process: 321, x: 400, y: 200, width: 58, height: 22, anchors,
  host: { name: "wezterm", executable: "C:\\Portable WezTerm\\wezterm.exe", class: "custom-wezterm",
    client: { Left: 0, Top: 0, Right: 672, Bottom: 420 } } };
const text = "Header\n" + "Directory".padEnd(20) + anchors[0].text + "\n" +
  "Other sidebar row".padEnd(20) + anchors[1].text;

test("WezTerm matches rows despite different sidebar labels and bounds custom padding", () => {
  assert.deepEqual(wezterm.origin(text, anchors, 22, 24, 80), { row: 1, min: 20, max: 20 });
  assert.deepEqual(wezterm.bounds(request, pane, [pane], text), {
    left: 192, right: 624, top: 52, bottom: 368,
  });
  for (const position of [{ x: 50 }, { y: 10 }, { x: 670 }, { y: 419 }]) {
    assert.equal(wezterm.bounds({ ...request, ...position }, pane, [pane], text), undefined);
  }
});

test("Unicode prefixes use intersected column intervals without counting UTF-16 as cells", () => {
  const content = "\n目录" + " ".repeat(16) + anchors[0].text + "\n" +
    "😀" + " ".repeat(18) + anchors[1].text;
  assert.deepEqual(wezterm.origin(content, anchors, 22, 24, 80), { row: 1, min: 18, max: 20 });
  assert.ok(wezterm.bounds(request, pane, [pane], content));
});

test("missing, duplicated or stale visible content cannot identify a pane", () => {
  for (const content of ["", anchors[0].text, text + "\n\n" + text]) {
    assert.equal(wezterm.origin(content, anchors, 2, 60, 80), undefined);
  }
  assert.equal(wezterm.bounds(request, pane, [pane], "New conversation\nDifferent output"), undefined);
});

test("WezTerm split and zoom geometry exclude neighbouring panes", () => {
  const other = { ...pane, pane_id: 1, size: { ...pane.size, cols: 40, pixel_width: 320 } };
  const right = { ...pane, left_col: 41 };
  const splitRequest = { ...request, x: 760, host: { ...request.host,
    client: { Left: 0, Top: 0, Right: 1000, Bottom: 420 } } };
  assert.ok(wezterm.bounds(splitRequest, right, [right, other], text));
  assert.equal(wezterm.bounds({ ...splitRequest, x: 200 }, right, [right, other], text), undefined);
  assert.ok(wezterm.bounds(request, { ...right, is_zoomed: true }, [right, other], text));
  const below = { ...pane, top_row: 25 };
  const vertical = { ...request, y: 700, host: { ...request.host,
    client: { Left: 0, Top: 0, Right: 672, Bottom: 820 } } };
  assert.ok(wezterm.bounds(vertical, below, [pane, below], text));
  assert.equal(wezterm.bounds({ ...vertical, y: 200 }, below, [pane, below], text), undefined);
  assert.equal(wezterm.bounds({ ...request, host: { ...request.host,
    client: { Left: 0, Top: 0, Right: 100, Bottom: 100 } } }, pane, [pane], text), undefined);
});

function cliFixture({ pid = request.process, focus = 0, changedFocus = focus, output = text, active = true } = {}) {
  const calls = [];
  let reads = 0;
  return { calls, execute: async (binary, args, options) => {
    calls.push({ binary, args, options });
    const command = args[4];
    if (command === "list-clients") return { stdout: JSON.stringify([
      { pid, focused_pane_id: reads++ ? changedFocus : focus },
    ]) };
    if (command === "list") return { stdout: JSON.stringify([{ ...pane, is_active: active }]) };
    assert.equal(command, "get-text");
    return { stdout: output };
  } };
}

test("WezTerm uses the adjacent CLI with public read-only commands and rechecks GUI focus", async () => {
  const fixture = cliFixture();
  const env = { WEZTERM_UNIX_SOCKET: "existing-gui-socket" };
  assert.ok(await wezterm.verify(request, env, fixture.execute));
  assert.deepEqual(fixture.calls.map(item => item.args[4]), ["list-clients", "list", "get-text", "list-clients"]);
  for (const call of fixture.calls) {
    assert.equal(call.binary, request.host.executable);
    assert.deepEqual(call.args.slice(0, 4), ["cli", "--no-auto-start", "--class", "custom-wezterm"]);
    assert.equal(call.options.env, env);
    assert.equal(call.options.cwd, path.join(os.homedir(), ".local", "share", "wezterm"));
    assert.equal(call.options.windowsHide, true);
    assert.equal(call.options.timeout, 1000);
  }
  assert.deepEqual(fixture.calls[2].args.slice(5), ["--pane-id", "0", "--start-line", "0", "--end-line", "24"]);
});

test("wrong GUI, inactive pane, switched focus and unavailable CLI leave unread intact", async () => {
  for (const options of [{ pid: 999 }, { focus: 1 }, { focus: null }, { changedFocus: 2 }, { active: false }, { output: "" }]) {
    assert.equal(await wezterm.verify(request, {}, cliFixture(options).execute), undefined);
  }
  for (const execute of [async () => { throw new Error("CLI unavailable"); },
    async () => ({ stdout: "unsupported command" })]) {
    assert.equal(await wezterm.verify(request, {}, execute), undefined);
  }
});
