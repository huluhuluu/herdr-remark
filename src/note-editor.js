"use strict";

const readline = require("node:readline");
const { saveNote } = require("./remark");

async function edit() {
  if (!process.env.REMARK_TERMINAL) throw new Error("请通过备注快捷键打开编辑器。");
  process.stdout.write("\x1b[2J\x1b[H备注 · Enter 保存 · 空行清除 · Ctrl-C 取消（80 字以内）\r\n\r\n");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const answer = await new Promise(resolve => {
    rl.on("SIGINT", () => { resolve(null); rl.close(); });
    // EOF is cancellation, never an empty-note save.
    rl.on("close", () => resolve(null));
    rl.question("> ", resolve);
    rl.write(process.env.REMARK_INITIAL || "");
  });
  rl.close();
  if (answer !== null) saveNote(process.env.REMARK_TERMINAL, answer);
}

edit().catch(e => {
  process.stderr.write("remark: " + e.message + "\n");
  process.exitCode = 1;
  // Leave errors visible; successful saves close immediately.
  setTimeout(() => {}, 2500);
});
