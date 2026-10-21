#!/bin/sh
set -eu

command -v node >/dev/null 2>&1 || { echo "Node.js is required." >&2; exit 1; }
remark_root="$(CDPATH= cd -P "$(dirname "$0")/.." && pwd)"
exec node "$remark_root/scripts/install.js" "$@"
