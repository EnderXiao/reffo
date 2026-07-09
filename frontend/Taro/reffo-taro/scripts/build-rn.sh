#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RAW_MODE_PATCH_ARG="--require=$SCRIPT_DIR/patch-stdin-raw-mode.cjs"

case " ${NODE_OPTIONS:-} " in
  *" $RAW_MODE_PATCH_ARG "*) ;;
  *)
    export NODE_OPTIONS="$RAW_MODE_PATCH_ARG${NODE_OPTIONS:+ $NODE_OPTIONS}"
    ;;
esac

exec "$SCRIPT_DIR/with-node22.sh" \
  node \
  "$PROJECT_ROOT/node_modules/@tarojs/cli/bin/taro" \
  build \
  --type rn \
  "$@"
