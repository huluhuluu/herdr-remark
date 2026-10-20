"use strict";

const path = require("node:path");

// Terminal output and pane titles routinely carry escape sequences. Strip them
// before they reach a sidebar token, where they would render as visible junk.
function clean(text) {
  return Array.from(String(text || "")
    // OSC (ESC ] ... BEL or ST) carries no visible text; strip it before the
    // generic control-character pass would turn its payload into visible junk.
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\|$)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    // Other ESC sequences include intermediate bytes, e.g. ESC ( B selects ASCII.
    .replace(/\x1b[ -/]*[0-~]?/g, "")
    .replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim())
    .slice(0, 80).join("");
}

// The directory shown on a sidebar row, derived from a pane's cwd. The parser
// is chosen per path so a Windows-style path is understood even when the plugin
// itself runs on another platform. An empty path yields nothing rather than the
// filesystem root, which would otherwise render as a bogus folder name.
function directory(cwd = "") {
  if (!cwd) return "";
  const parser = cwd.includes("\\") || /^[A-Za-z]:/.test(cwd) ? path.win32 : path.posix;
  return clean(parser.basename(cwd) || parser.parse(cwd).root);
}

module.exports = { clean, directory };
