#!/usr/bin/env bash

set -euo pipefail

resolve_node_major() {
  node -p "process.versions.node.split('.')[0]" 2>/dev/null || true
}

find_node22_bin() {
  local root candidate

  if [[ -n "${REFFO_NODE22_BIN:-}" ]] && [[ -x "${REFFO_NODE22_BIN%/}/node" ]]; then
    printf '%s\n' "${REFFO_NODE22_BIN%/}"
    return 0
  fi

  for root in "${NVM_DIR:-$HOME/.nvm}/versions/node" "$HOME/.nvm/versions/node"; do
    [[ -d "$root" ]] || continue
    candidate="$(find "$root" -maxdepth 3 -type f -path '*/v22.*/bin/node' 2>/dev/null | sort -V | tail -n 1)"
    if [[ -n "$candidate" ]]; then
      dirname "$candidate"
      return 0
    fi
  done

  return 1
}

ensure_node22() {
  local current_major node22_bin resolved_major

  current_major="$(resolve_node_major)"
  if [[ "$current_major" == "22" ]]; then
    return 0
  fi

  node22_bin="$(find_node22_bin || true)"
  if [[ -z "$node22_bin" ]]; then
    echo "Node 22 is required for Reffo RN scripts. Run 'nvm use 22' or set REFFO_NODE22_BIN." >&2
    exit 1
  fi

  export PATH="$node22_bin:$PATH"
  hash -r

  resolved_major="$(resolve_node_major)"
  if [[ "$resolved_major" != "22" ]]; then
    echo "Failed to switch to Node 22. Current node is $(command -v node)." >&2
    exit 1
  fi
}

ensure_node22

if [[ "${REFFO_NODE22_DEBUG:-0}" == "1" ]]; then
  echo "Using Node $(node -v) from $(command -v node)" >&2
fi

exec "$@"
