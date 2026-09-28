"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

function edit(input, initial = "默认摘要") {
  const child = spawnSync(process.execPath, ["-e", `
    require('./src/remark').saveNote = (id, note) =>
      process.stdout.write('SAVED:' + JSON.stringify({ id, note }) + '\\n');
    require('./src/note-editor');
  `], {
    cwd: path.resolve(__dirname, ".."), input, encoding: "utf8", timeout: 5000,
    env: { ...process.env, TERM: "xterm-256color", REMARK_TERMINAL: "terminal-test", REMARK_INITIAL: initial },
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  const saved = child.stdout.match(/SAVED:(.*)/);
  return saved ? JSON.parse(saved[1]) : null;
}

test("popup editor accepts prefill, replacement and empty-note clearing", () => {
  assert.deepEqual(edit("\r"), { id: "terminal-test", note: "默认摘要" });
  assert.deepEqual(edit("\u0015新的备注\r"), { id: "terminal-test", note: "新的备注" });
  assert.deepEqual(edit("\u0015\r"), { id: "terminal-test", note: "" });
});

test("popup editor cancels on Ctrl-C and EOF without saving", () => {
  assert.equal(edit("\u0003"), null);
  assert.equal(edit(""), null);
});
