"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const held = new Map();
// Windows sharing violations can outlive a synchronous read/rename call.
// Wait briefly for the other process without dropping its registration.
const FILE_RETRY_DELAY_MS = 10;
const FILE_RETRY_TIMEOUT_MS = 1000;
const retrySignal = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

function retryFile(operation) {
  const deadline = performance.now() + FILE_RETRY_TIMEOUT_MS;
  for (;;) {
    try { return operation(); }
    catch (error) {
      if (process.platform !== "win32" || !["EPERM", "EBUSY"].includes(error.code) || performance.now() >= deadline) throw error;
      Atomics.wait(retrySignal, 0, 0, FILE_RETRY_DELAY_MS);
    }
  }
}

function remove(file) {
  retryFile(() => fs.rmSync(file, { force: true }));
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}

function read(file) {
  try { return retryFile(() => fs.readFileSync(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}

function candidates(file) {
  const directory = file + ".claims";
  let names;
  try { names = fs.readdirSync(directory); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  return names.filter(name => /^\d+-[0-9a-f-]+$/.test(name)).flatMap(name => {
    const pid = Number(name.split("-")[0]);
    const entry = path.join(directory, name);
    if (!alive(pid)) {
      // Each registration has a unique name; reclaiming it cannot remove a
      // replacement owner's registration, even when several processes race.
      remove(entry);
      remove(entry + ".tmp");
      return [];
    }
    const ticket = read(entry);
    return fs.existsSync(entry) ? [{ entry, pid, ticket: Number(ticket) || 0 }] : [];
  });
}

function owner(file) {
  const pid = Number(read(file));
  return alive(pid) ? pid : candidates(file)[0]?.pid || 0;
}

function publish(file, value, temporary) {
  try {
    fs.writeFileSync(temporary, String(value), { flag: "wx" });
    retryFile(() => fs.renameSync(temporary, file));
  } finally { remove(temporary); }
}

async function claim(file) {
  if (held.has(file) || alive(Number(read(file)))) return false;
  fs.mkdirSync(file + ".claims", { recursive: true });
  const entry = path.join(file + ".claims", process.pid + "-" + randomUUID());
  // Bakery ordering: publish choosing (0), then a ticket above every visible
  // ticket. Wait for choosers before deciding priority. Late arrivals cannot
  // overtake a holder; unlike deleting a shared stale lock, no CAS is needed.
  let acquired = false;
  try {
    fs.writeFileSync(entry, "0", { flag: "wx" });
    const ticket = Math.max(0, ...candidates(file).map(item => item.ticket)) + 1;
    publish(entry, ticket, entry + ".tmp");
    for (;;) {
      const others = candidates(file).filter(item => item.entry !== entry);
      if (others.some(item => item.ticket === 0)) {
        await new Promise(resolve => setTimeout(resolve, 10));
        continue;
      }
      if (others.some(item => item.ticket < ticket ||
          (item.ticket === ticket && item.entry < entry))) return false;
      // Retain the PID file for cheap running checks and handoff from an older
      // monitor. New monitors coordinate through registrations, not this file.
      publish(file, process.pid, entry + ".tmp");
      held.set(file, entry);
      acquired = true;
      return true;
    }
  } finally {
    if (!acquired) remove(entry);
  }
}

function release(file) {
  const entry = held.get(file);
  if (!entry) return;
  if (Number(read(file)) === process.pid) remove(file);
  remove(entry);
  held.delete(file);
}

module.exports = { owner, claim, release };
