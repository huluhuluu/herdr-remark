"use strict";

// Minimal ANSI helpers, so escape bytes are written with explicit \x1b and
// never depend on the source file carrying literal control characters.

const ESC = "\x1b";

module.exports = {
  reset: `${ESC}[0m`,
  bold: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  reverse: `${ESC}[7m`,
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  blue: `${ESC}[34m`,
  magenta: `${ESC}[35m`,
  cyan: `${ESC}[36m`,
  gray: `${ESC}[90m`,
  clearScreen: `${ESC}[2J${ESC}[H`,
  hideCursor: `${ESC}[?25l`,
  showCursor: `${ESC}[?25h`,
  home: `${ESC}[H`,
  clearLine: `${ESC}[2K`,
  /** Absolute cursor placement, 1-based. */
  to: (row, col) => `${ESC}[${row};${col}H`,
  // SGR (1006) extended mouse reporting on top of normal (1000) tracking:
  // press, release, and wheel, with coordinates that survive past column 223.
  mouseOn: `${ESC}[?1000h${ESC}[?1006h`,
  mouseOff: `${ESC}[?1006l${ESC}[?1000l`,
};
