#!/usr/bin/env bash
set -euo pipefail

mode="${1:-apply}"
if [[ "$mode" != "apply" && "$mode" != "--check-only" ]]; then
  echo "usage: $0 [--check-only]" >&2
  exit 2
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

migration_dir="supabase/migrations"
migrations=()
while IFS= read -r migration; do
  migrations+=("$migration")
done < <(find "$migration_dir" -maxdepth 1 -type f -name '*.sql' | sort)
if [[ "${#migrations[@]}" -eq 0 ]]; then
  echo "未找到 Supabase migration 文件：${migration_dir}" >&2
  exit 1
fi

invalid=0
untracked=0
for migration in "${migrations[@]}"; do
  filename="$(basename "$migration")"
  if [[ ! "$filename" =~ ^[0-9]{12,14}_[a-z0-9_]+\.sql$ ]]; then
    echo "migration 文件名不符合规范：${migration}" >&2
    invalid=1
  fi
  if ! git ls-files --error-unmatch "$migration" >/dev/null 2>&1; then
    echo "migration 文件未纳入 Git：${migration}" >&2
    untracked=1
  fi
done

if [[ "$invalid" -ne 0 || "$untracked" -ne 0 ]]; then
  exit 1
fi

printf 'Supabase migration files tracked: %s\n' "${#migrations[@]}"
if [[ "$mode" == "--check-only" ]]; then
  exit 0
fi

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "缺少 SUPABASE_DB_URL，禁止跳过 Supabase migration 后继续部署" >&2
  exit 1
fi

supabase_cli="${SUPABASE_CLI:-backend/node_modules/.bin/supabase}"
if [[ ! -x "$supabase_cli" ]]; then
  echo "Supabase CLI 不可用：${supabase_cli}" >&2
  exit 1
fi

export SUPABASE_TELEMETRY_DISABLED=true
printf 'Supabase migration environment: %s\n' "${SUPABASE_MIGRATION_ENV:-unknown}"
"$supabase_cli" migration list --workdir "$repo_root" --db-url "$SUPABASE_DB_URL"
"$supabase_cli" db push --workdir "$repo_root" --db-url "$SUPABASE_DB_URL"
"$supabase_cli" migration list --workdir "$repo_root" --db-url "$SUPABASE_DB_URL"
