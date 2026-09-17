#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$PROJECT_DIR/dist"
OUTPUT_DIR="$PROJECT_DIR/../../../output"
OUTPUT_FILE="$OUTPUT_DIR/reffo-redbook-minitool.zip"
AUDIT_SCRIPT="${MINITOOL_AUDIT_SCRIPT:-/Users/mi/.codex/skills/minitool-zip-builder/scripts/audit_artifact.mjs}"

cd "$PROJECT_DIR"

if [[ "${REFFO_MINITOOL_SKIP_BUILD:-0}" != "1" ]]; then
  pnpm build:h5
fi

if [[ ! -f "$DIST_DIR/index.html" ]]; then
  echo "缺少 H5 构建入口：$DIST_DIR/index.html" >&2
  exit 1
fi

STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/reffo-minitool.XXXXXX")"
cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

while IFS= read -r -d '' source_file; do
  relative_path="${source_file#"$DIST_DIR"/}"
  case "$relative_path" in
    *.map|*.txt) continue ;;
    *.html|*.css|*.js|*.json|*.png|*.jpg|*.jpeg|*.gif|*.webp|*.svg|*.woff|*.woff2) ;;
    *) continue ;;
  esac

  target_file="$STAGING_DIR/$relative_path"
  mkdir -p "$(dirname "$target_file")"
  cp "$source_file" "$target_file"
done < <(find "$DIST_DIR" -type f -print0)

if [[ ! -f "$STAGING_DIR/index.html" ]]; then
  echo "打包目录缺少根目录入口：index.html" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
rm -f "$OUTPUT_FILE"

(
  cd "$STAGING_DIR"
  zip -qr "$OUTPUT_FILE" .
)

if [[ -f "$AUDIT_SCRIPT" ]]; then
  node "$AUDIT_SCRIPT" "$STAGING_DIR"
  node "$AUDIT_SCRIPT" "$OUTPUT_FILE"
else
  echo "未找到小工具审计脚本：$AUDIT_SCRIPT" >&2
  exit 1
fi

echo "已生成：$OUTPUT_FILE"
