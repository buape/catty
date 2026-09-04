#!/usr/bin/env bash
set -euo pipefail

# Catty passes JSON args on stdin and in CATTY_ARGS_JSON.
# Replace this example with real email API/CLI logic.
printf '{"ok":true,"message":"example only: would mark email as read","args":%s}\n' "${CATTY_ARGS_JSON:-{}}"
