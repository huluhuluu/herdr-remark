"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { completion, activityTokens, stateOf, readTokens, scrollBaseline } = require("../src/tokens");

function observe(pane, status, seq) {
  pane.agent_status = status;
  pane.state_change_seq = seq;
  Object.assign(pane.tokens, activityTokens(pane));
}

test("read completions survive idle/done presentation changes and detection recovery", () => {
  const pane = { terminal_id: "term", tokens: {} };
  observe(pane, "working", 10);
  observe(pane, "done", 11);
  pane.tokens.remark_seen = completion(pane);
  for (const [status, seq] of [["idle", 11], ["unknown", 12], ["done", 13], ["idle", 13]]) {
    observe(pane, status, seq);
    if (status === "unknown") continue;
    assert.equal(completion(pane), "11");
    assert.equal(stateOf(pane), "idle");
  }
  observe(pane, "working", 14);
  observe(pane, "done", 15);
  assert.equal(completion(pane), "15");
  assert.equal(stateOf(pane), "unread");
});

test("an idle baseline does not invent a completion when native seen presentation changes", () => {
  const pane = { terminal_id: "term", tokens: {} };
  observe(pane, "idle", 1);
  observe(pane, "done", 1);
  assert.equal(stateOf(pane), "idle");
  observe(pane, "unknown", 2);
  observe(pane, "done", 3);
  assert.equal(stateOf(pane), "idle");
});

test("native done can recover a missed round when the lifecycle sequence advances", () => {
  const pane = { terminal_id: "term", tokens: {} };
  observe(pane, "done", 1);
  pane.tokens.remark_seen = "1";
  observe(pane, "done", 3);
  assert.equal(completion(pane), "3");
  assert.equal(stateOf(pane), "unread");
});

test("an unread completion also survives detection recovery without being acknowledged", () => {
  const pane = { terminal_id: "term", tokens: {} };
  observe(pane, "done", 1);
  observe(pane, "unknown", 2);
  observe(pane, "idle", 3);
  assert.equal(completion(pane), "1");
  assert.equal(stateOf(pane), "unread");
});

test("observed work survives unknown snapshots until one new completion is recorded", () => {
  for (const status of ["working", "blocked"]) {
    for (const completed of ["idle", "done"]) {
      const pane = { terminal_id: "term", tokens: {} };
      observe(pane, "done", 1);
      pane.tokens.remark_seen = "1";
      observe(pane, status, 2);
      observe(pane, "unknown", 3);
      observe(pane, "unknown", 4);
      Object.assign(pane.tokens, readTokens(pane, false));
      observe(pane, completed, 5);
      assert.equal(completion(pane), "5", `${status} -> unknown -> ${completed}`);
      assert.equal(stateOf(pane), "unread");
      Object.assign(pane.tokens, readTokens(pane, false));
      observe(pane, "unknown", 6);
      observe(pane, completed, 7);
      assert.equal(completion(pane), "5");
      assert.equal(stateOf(pane), "idle");
    }
  }
});

test("a legacy working record also retains pending work through unknown", () => {
  const pane = { terminal_id: "term", tokens: {
    remark_activity: JSON.stringify(["term", "1", "working", null]),
  } };
  observe(pane, "unknown", 2);
  observe(pane, "idle", 3);
  assert.equal(completion(pane), "3");
  assert.equal(stateOf(pane), "unread");
});

test("viewing an unknown or working agent does not erase its previously read round", () => {
  const pane = { terminal_id: "term", tokens: {} };
  observe(pane, "done", 1);
  pane.tokens.remark_seen = "1";
  observe(pane, "unknown", 2);
  Object.assign(pane.tokens, readTokens(pane, true, 100));
  Object.assign(pane.tokens, readTokens(pane, false));
  observe(pane, "idle", 3);
  assert.equal(pane.tokens.remark_seen, "1");
  assert.equal(stateOf(pane), "idle");
  observe(pane, "working", 4);
  Object.assign(pane.tokens, readTokens(pane, false));
  observe(pane, "idle", 5);
  assert.equal(stateOf(pane), "unread");
});

test("completion scroll baseline is captured once and belongs to its round", () => {
  const initial = { offset_from_bottom: 0, max_offset_from_bottom: 100, viewport_rows: 30 };
  const pane = { terminal_id: "term", tokens: {}, scroll: initial };
  observe(pane, "working", 1);
  observe(pane, "idle", 2);
  assert.deepEqual(scrollBaseline(pane), initial);
  pane.scroll = { ...initial, offset_from_bottom: 3 };
  observe(pane, "idle", 2);
  assert.deepEqual(scrollBaseline(pane), initial);
  observe(pane, "working", 3);
  observe(pane, "idle", 4);
  assert.deepEqual(scrollBaseline(pane), pane.scroll);
  pane.tokens.remark_unread = "manual";
  pane.tokens.remark_scroll = JSON.stringify(initial);
  assert.deepEqual(scrollBaseline(pane), initial);
  pane.tokens.remark_scroll = "broken";
  assert.equal(scrollBaseline(pane), undefined);
});
