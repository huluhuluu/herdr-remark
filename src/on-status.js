"use strict";

// pane.agent_status_changed -> auto-flag the pane unread and pop a desktop
// notification. This is what turns "agent finished while I was elsewhere" into
// a durable unread row instead of a status you have to notice in time.

const herdr = require("./herdr");
const state = require("./state");
const core = require("./core");
const ev = require("./event");

const TITLES = {
  done: "Agent 已完成",
  blocked: "Agent 等待输入",
  idle: "Agent 空闲",
  working: "Agent 开始工作",
  unknown: "Agent 状态未知",
};

ev.guard(async () => {
  const { data } = ev.readEvent();
  const paneId = ev.eventPaneId(data);
  const status = ev.eventStatus(data);
  if (!paneId || !status) return;

  const cfg = state.loadConfig();
  const triggers = Array.isArray(cfg.auto_mark_on) ? cfg.auto_mark_on : [];
  if (!triggers.includes(status)) return;

  // Already flagged: keep the existing mark and stay quiet rather than
  // re-notifying on every status wobble.
  const existing = state.getPane(state.readState(), paneId);
  if (existing && existing.unread) return;

  if (!cfg.auto_mark_when_focused) {
    const pane = herdr.listPanes().find((p) => p.pane_id === paneId);
    if (pane && pane.focused) return;
  }

  const entry = core.mark(paneId, { reason: status, status });

  if (cfg.sort_unread_first) {
    try {
      await herdr.applyUnreadView();
    } catch {
      /* sidebar ordering is a nicety; the token is already reported */
    }
  }

  if (cfg.notify_on_auto_mark) {
    const agent = ev.eventAgent(data) || "agent";
    const detail = core.sanitizeNote(entry.note) || ev.eventTitle(data);
    const body = detail ? `${agent} · ${detail}` : agent;
    herdr.notify(TITLES[status] || "Agent 状态变化", body, {
      sound: core.resolveSound(cfg, status),
    });
  }
});
