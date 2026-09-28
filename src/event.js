"use strict";

// Shared event-hook plumbing.
//
// HERDR_PLUGIN_EVENT_JSON is parsed defensively: accept either the raw
// subscription envelope ({event, data}) or a bare payload, so the hook keeps
// working if the wrapper shape changes.

function readEvent() {
  const raw = process.env.HERDR_PLUGIN_EVENT_JSON;
  const name = process.env.HERDR_PLUGIN_EVENT || "";
  if (!raw) return { name, data: {} };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { name, data: {} };
  }
  if (parsed && typeof parsed === "object") {
    const data = parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
    return { name: parsed.event || name, data };
  }
  return { name, data: {} };
}

/** Pull the pane id out of any of the shapes a pane event may arrive in. */
function eventPaneId(data) {
  if (!data || typeof data !== "object") return null;
  if (typeof data.pane_id === "string") return data.pane_id;
  if (data.pane && typeof data.pane.pane_id === "string") return data.pane.pane_id;
  return process.env.HERDR_PANE_ID || null;
}

function eventStatus(data) {
  if (!data || typeof data !== "object") return null;
  if (typeof data.agent_status === "string") return data.agent_status;
  if (data.pane && typeof data.pane.agent_status === "string") {
    return data.pane.agent_status;
  }
  return null;
}

function eventAgent(data) {
  if (!data || typeof data !== "object") return null;
  return (
    data.display_agent ||
    data.agent ||
    (data.pane && (data.pane.display_agent || data.pane.agent)) ||
    null
  );
}

function eventTitle(data) {
  if (!data || typeof data !== "object") return "";
  return (
    data.title ||
    (data.pane && (data.pane.terminal_title_stripped || data.pane.title)) ||
    ""
  );
}

/** Hooks must never take down the server; log and exit 0. */
function guard(fn) {
  Promise.resolve()
    .then(fn)
    .catch((e) => {
      process.stderr.write(`agent-inform hook: ${e.message}\n`);
      process.exit(0);
    });
}

module.exports = { readEvent, eventPaneId, eventStatus, eventAgent, eventTitle, guard };
