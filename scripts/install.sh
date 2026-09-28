#!/usr/bin/env bash
set -euo pipefail

command -v node >/dev/null 2>&1 || { echo "Node.js 18+ is required." >&2; exit 1; }
remark_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$remark_root/scripts/install.js" "$@"
