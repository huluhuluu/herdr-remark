"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const lock = require("../src/monitor-lock");

function temporaryLock(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "remark-lock-test-"));
  const file = path.join(directory, "blink.lock");
  t.after(() => { lock.release(file); fs.rmSync(directory, { recursive: true, force: true }); });
  return file;
}

function worker(t, file) {
  const source = `
    const fs = require('node:fs');
    const path = require('node:path');
    const {randomUUID} = require('node:crypto');
    const lock = require(${JSON.stringify(require.resolve("../src/monitor-lock"))});
    const file = process.argv[1];
    process.on('message', async command => {
      if (command === 'claim') process.send({claimed: await lock.claim(file)});
      if (command === 'choose') {
        fs.mkdirSync(file + '.claims', {recursive: true});
        fs.writeFileSync(path.join(file + '.claims', process.pid + '-' + randomUUID()), '0', {flag: 'wx'});
        process.send({choosing: true});
      }
      if (command === 'release') { lock.release(file); process.disconnect(); }
    });
    process.send({ready: true});
  `;
  const child = spawn(process.execPath, ["-e", source, file], {
    windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const ready = once(child, "message");
  const exited = once(child, "exit");
  t.after(async () => { if (child.exitCode === null) child.kill(); await exited; });
  return { child, ready, exited };
}

async function send(child, command) {
  const response = once(child, "message");
  child.send(command);
  return (await response)[0];
}

test("simultaneous stale-lock contenders elect one holder and leave no registrations", { timeout: 20000 }, async t => {
  const file = temporaryLock(t);
  for (let round = 0; round < 3; round++) {
    fs.writeFileSync(file, "999999999");
    const workers = Array.from({ length: 4 }, () => worker(t, file));
    await Promise.all(workers.map(item => item.ready));
    const results = await Promise.all(workers.map(item => send(item.child, "claim")));
    assert.equal(results.filter(item => item.claimed).length, 1);
    const winner = workers[results.findIndex(item => item.claimed)].child;
    assert.equal(lock.owner(file), winner.pid);
    for (const { child } of workers) child.send("release");
    await Promise.all(workers.map(item => item.exited));
    assert.equal(fs.existsSync(file), false);
    assert.deepEqual(fs.readdirSync(file + ".claims"), []);
  }
});

test("a chooser that crashes cannot strand a waiting contender", { timeout: 10000 }, async t => {
  const file = temporaryLock(t);
  const item = worker(t, file);
  await item.ready;
  assert.deepEqual(await send(item.child, "choose"), { choosing: true });
  let settled = false;
  const waiting = lock.claim(file).then(value => { settled = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(settled, false, "a live chooser must finish publishing its ticket first");
  item.child.kill();
  await item.exited;
  assert.equal(await waiting, true);
  assert.equal(lock.owner(file), process.pid);
  lock.release(file);
  assert.deepEqual(fs.readdirSync(file + ".claims"), []);
});

test("a failed owner publication removes its registration", async t => {
  const file = temporaryLock(t);
  const rename = fs.renameSync;
  t.mock.method(fs, "renameSync", (from, to) => {
    if (to === file) throw Object.assign(Error("permission denied"), { code: "EACCES" });
    return rename(from, to);
  });
  await assert.rejects(lock.claim(file), { code: "EACCES" });
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(fs.readdirSync(file + ".claims"), []);
});
