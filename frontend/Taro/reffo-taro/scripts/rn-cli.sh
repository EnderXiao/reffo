#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

setup_android_dev_reverse() {
  local device_id=""
  local expect_device_id=0

  for arg in "$@"; do
    if [[ "$expect_device_id" -eq 1 ]]; then
      device_id="$arg"
      expect_device_id=0
      continue
    fi

    if [[ "$arg" == "--deviceId" ]]; then
      expect_device_id=1
    fi
  done

  local adb_args=()
  if [[ -n "$device_id" ]]; then
    adb_args=(-s "$device_id")
  fi

  if command -v adb >/dev/null 2>&1; then
    adb "${adb_args[@]}" reverse tcp:3000 tcp:3000 >/dev/null 2>&1 || true
  fi
}

if [[ "${1:-}" == "run-android" ]]; then
  setup_android_dev_reverse "$@"
fi

exec "$SCRIPT_DIR/with-node22.sh" \
  node \
  "$PROJECT_ROOT/node_modules/react-native/cli.js" \
  "$@"
