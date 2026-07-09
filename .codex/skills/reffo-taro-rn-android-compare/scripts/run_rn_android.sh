#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
find_repo_root() {
  local start_dir="$1"
  local current_dir="$start_dir"

  while [[ "$current_dir" != "/" ]]; do
    if [[ -f "$current_dir/frontend/Taro/reffo-taro/package.json" ]]; then
      echo "$current_dir"
      return 0
    fi
    if [[ -d "$current_dir/.git" ]]; then
      echo "$current_dir"
      return 0
    fi
    current_dir="$(dirname "$current_dir")"
  done

  return 1
}

REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$REPO_ROOT" ]]; then
  REPO_ROOT="$(find_repo_root "$SCRIPT_DIR" || true)"
fi
if [[ -z "$REPO_ROOT" ]]; then
  echo "Could not determine repo root. Pass --project-root and --artifact-root explicitly." >&2
  exit 1
fi
PROJECT_ROOT="$REPO_ROOT/frontend/Taro/reffo-taro"
ARTIFACT_ROOT="$REPO_ROOT/.artifacts/reffo-rn-android"
LOG_ROOT="$ARTIFACT_ROOT/logs"
DEVICE_ID=""
METRO_PORT="8083"
SKIP_DEV_RN=0
SKIP_METRO=0
SKIP_ANDROID=0
NODE22_WRAPPER=""
RN_CLI_WRAPPER=""

usage() {
  cat <<'EOF'
Usage:
  run_rn_android.sh [options]

Options:
  --device <serial>         Install the app to a specific adb device.
  --project-root <path>     Override the RN project root.
  --artifact-root <path>    Override the artifact/log directory.
  --skip-dev-rn             Do not start or reuse `pnpm dev:rn`.
  --skip-metro              Do not start or reuse `pnpm start`.
  --skip-android            Do not run `react-native run-android`.
  -h, --help                Show this help.

The script starts long-running Taro and Metro processes in the background,
stores logs under `.artifacts/reffo-rn-android/logs/`, and then installs the
Android app on the selected device.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --device)
      DEVICE_ID="${2:-}"
      shift 2
      ;;
    --project-root)
      PROJECT_ROOT="${2:-}"
      shift 2
      ;;
    --artifact-root)
      ARTIFACT_ROOT="${2:-}"
      LOG_ROOT="$ARTIFACT_ROOT/logs"
      shift 2
      ;;
    --skip-dev-rn)
      SKIP_DEV_RN=1
      shift
      ;;
    --skip-metro)
      SKIP_METRO=1
      shift
      ;;
    --skip-android)
      SKIP_ANDROID=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

NODE22_WRAPPER="$PROJECT_ROOT/scripts/with-node22.sh"
RN_CLI_WRAPPER="$PROJECT_ROOT/scripts/rn-cli.sh"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "Missing required file: $1" >&2
    exit 1
  fi
}

wait_for_local_packager() {
  local port="$1"
  local attempts="${2:-20}"

  for ((attempt=1; attempt<=attempts; attempt+=1)); do
    if curl -fsS "http://127.0.0.1:${port}/status" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  return 1
}

ensure_reverse_health() {
  local port="$1"
  local adb_args=()
  local verify_cmd="curl -fsS http://127.0.0.1:${port}/status"

  if [[ -n "$DEVICE_ID" ]]; then
    adb_args=(-s "$DEVICE_ID")
  fi

  if ! adb "${adb_args[@]}" shell "command -v curl" >/dev/null 2>&1; then
    echo "Device curl is unavailable; skipping adb reverse health check."
    adb "${adb_args[@]}" reverse "tcp:${port}" "tcp:${port}" >/dev/null
    return 0
  fi

  adb "${adb_args[@]}" reverse "tcp:${port}" "tcp:${port}" >/dev/null
  if adb "${adb_args[@]}" shell "$verify_cmd" >/dev/null 2>&1; then
    return 0
  fi

  echo "adb reverse health check failed on port ${port}; restarting adb server."
  adb kill-server >/dev/null 2>&1 || true
  adb start-server >/dev/null

  if [[ -n "$DEVICE_ID" ]]; then
    adb -s "$DEVICE_ID" wait-for-device
  else
    adb wait-for-device
  fi

  adb "${adb_args[@]}" reverse --remove-all >/dev/null 2>&1 || true
  adb "${adb_args[@]}" reverse "tcp:${port}" "tcp:${port}" >/dev/null

  if adb "${adb_args[@]}" shell "$verify_cmd" >/dev/null 2>&1; then
    return 0
  fi

  echo "Failed to establish a healthy adb reverse tunnel to port ${port}." >&2
  return 1
}

resolve_java_major() {
  local spec_version

  spec_version="$(java -XshowSettings:properties -version 2>&1 | awk -F'= ' '/java\.specification\.version/ {print $2; exit}')"
  if [[ -z "$spec_version" ]]; then
    return 1
  fi

  if [[ "$spec_version" == 1.* ]]; then
    echo "${spec_version#1.}"
    return 0
  fi

  echo "${spec_version%%.*}"
}

ensure_java17() {
  local current_major=""

  current_major="$(resolve_java_major || true)"
  if [[ -n "$current_major" ]] && (( current_major >= 17 )); then
    return 0
  fi

  if [[ -x /usr/libexec/java_home ]]; then
    local java17_home=""
    java17_home="$(/usr/libexec/java_home -v 17 2>/dev/null || true)"
    if [[ -n "$java17_home" ]]; then
      export JAVA_HOME="$java17_home"
      export PATH="$JAVA_HOME/bin:$PATH"
      echo "Using Java 17 from $JAVA_HOME"
      return 0
    fi
  fi

  echo "Java 17 is required for Android builds, but no local JDK 17 was found." >&2
  exit 1
}

start_service() {
  local name="$1"
  local pid_file="$2"
  local log_file="$3"
  shift 3

  if [[ -f "$pid_file" ]]; then
    local existing_pid
    existing_pid="$(cat "$pid_file")"
    if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" >/dev/null 2>&1; then
      echo "Reusing $name (pid $existing_pid)"
      return 0
    fi
    rm -f "$pid_file"
  fi

  echo "Starting $name"
  (
    cd "$PROJECT_ROOT"
    nohup "$@" >"$log_file" 2>&1 &
    echo $! >"$pid_file"
  )
}

require_command node
require_command pnpm
require_command adb
require_command java
require_command curl
require_file "$NODE22_WRAPPER"
require_file "$RN_CLI_WRAPPER"

ensure_java17

if [[ ! -d "$PROJECT_ROOT/node_modules" ]]; then
  echo "Missing dependencies in $PROJECT_ROOT/node_modules. Install project dependencies before running this helper." >&2
  exit 1
fi

if [[ "$SKIP_DEV_RN" -eq 0 && "$SKIP_METRO" -eq 0 ]]; then
  echo "Skipping standalone Metro because \`pnpm dev:rn\` already starts React Native dev server on port $METRO_PORT."
  SKIP_METRO=1
fi

mkdir -p "$LOG_ROOT"

if [[ "$SKIP_DEV_RN" -eq 0 ]]; then
  start_service \
    "pnpm dev:rn" \
    "$LOG_ROOT/dev-rn.pid" \
    "$LOG_ROOT/dev-rn.log" \
    env CI=1 "$NODE22_WRAPPER" pnpm dev:rn
fi

if [[ "$SKIP_METRO" -eq 0 ]]; then
  start_service \
    "pnpm start" \
    "$LOG_ROOT/metro.pid" \
    "$LOG_ROOT/metro.log" \
    env CI=1 "$NODE22_WRAPPER" pnpm start
fi

if ! wait_for_local_packager "$METRO_PORT"; then
  echo "Metro did not become healthy on port $METRO_PORT." >&2
  exit 1
fi

if ! ensure_reverse_health "$METRO_PORT"; then
  exit 1
fi

if [[ "$SKIP_ANDROID" -eq 1 ]]; then
  echo "Skipped Android install. Logs are in $LOG_ROOT"
  exit 0
fi

ANDROID_CMD=("$RN_CLI_WRAPPER" run-android --no-packager)
if [[ -n "$DEVICE_ID" ]]; then
  ANDROID_CMD+=(--deviceId "$DEVICE_ID")
fi
ANDROID_CMD+=(--port "$METRO_PORT")

echo "Running: ${ANDROID_CMD[*]}"
(
  cd "$PROJECT_ROOT"
  "${ANDROID_CMD[@]}"
)

echo "Done. Logs are in $LOG_ROOT"
