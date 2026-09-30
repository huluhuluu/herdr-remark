"use strict";

const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const herdr = require("../src/herdr");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remark-herdr-test-"));
process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  for (const key of ["HERDR_BIN_PATH", "HERDR_PLUGIN_CONTEXT_JSON", "HERDR_PANE_ID"])
    delete process.env[key];
});

// `cli` spawns HERDR_BIN_PATH, so pointing that at Node runs a stub binary.
function stub(name, source) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, source);
  process.env.HERDR_BIN_PATH = process.execPath;
  return file;
}

test("cli returns the result body and reports Herdr failures verbatim", () => {
  const ok = stub("ok.js", 'process.stdout.write(JSON.stringify({ result: { pane: { pane_id: "w1:p1" } } }));');
  assert.equal(herdr.cli([ok]).pane.pane_id, "w1:p1");

  const failed = stub("failed.js",
    'process.stdout.write(JSON.stringify({ error: { message: "unknown pane" } })); process.exit(1);');
  assert.throws(() => herdr.cli([failed]), /unknown pane/);

  // A crashed binary prints no JSON, so the raw stderr is the only useful text.
  const crashed = stub("crashed.js", 'process.stderr.write("panic: bad state"); process.exit(2);');
  assert.throws(() => herdr.cli([crashed]), /panic: bad state/);

  // A command that succeeds without output still yields an object, not undefined.
  const silent = stub("silent.js", "");
  assert.deepEqual(herdr.cli([silent]), {});
});

test("envJson treats a missing variable as empty and names a malformed one", () => {
  assert.deepEqual(herdr.envJson("REMARK_TEST_ABSENT"), {});
  process.env.REMARK_TEST_JSON = '{"focused_pane_id":"w1:p1"}';
  assert.equal(herdr.envJson("REMARK_TEST_JSON").focused_pane_id, "w1:p1");
  process.env.REMARK_TEST_JSON = "{oops";
  assert.throws(() => herdr.envJson("REMARK_TEST_JSON"), /REMARK_TEST_JSON 不是合法的 JSON/);
  delete process.env.REMARK_TEST_JSON;
});

test("branch is empty without a directory and outside a repository", () => {
  assert.equal(herdr.branch(""), "");
  assert.equal(herdr.branch(dir), "");
});
