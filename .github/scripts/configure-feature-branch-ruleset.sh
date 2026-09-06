#!/usr/bin/env bash
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN is required}"
owner="${GITHUB_OWNER:-EnderXiao}"
repo="${GITHUB_REPO:-reffo}"
ruleset_name="${FEATURE_RULESET_NAME:-feature-branches-protected}"

api() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [[ -n "${body}" ]]; then
    curl -fsS -X "${method}" "https://api.github.com${path}" \
      -H "Authorization: Bearer ${GH_TOKEN}" \
      -H 'Accept: application/vnd.github+json' \
      -H 'X-GitHub-Api-Version: 2022-11-28' \
      -H 'Content-Type: application/json' \
      --data "${body}"
  else
    curl -fsS -X "${method}" "https://api.github.com${path}" \
      -H "Authorization: Bearer ${GH_TOKEN}" \
      -H 'Accept: application/vnd.github+json' \
      -H 'X-GitHub-Api-Version: 2022-11-28'
  fi
}

owner_id="${GITHUB_OWNER_ID:-$(api GET "/users/${owner}" | jq -r '.id')}"
if [[ -z "${owner_id}" || "${owner_id}" == 'null' ]]; then
  echo "unable to resolve GitHub owner id" >&2
  exit 1
fi

payload="$(jq -cn \
  --arg name "${ruleset_name}" \
  --argjson ownerId "${owner_id}" \
  '{name:$name,target:"branch",enforcement:"active",conditions:{ref_name:{include:["refs/heads/feature","refs/heads/feature/*"],exclude:[]}},bypass_actors:[{actor_id:$ownerId,actor_type:"User",bypass_mode:"always"}],rules:[{type:"deletion"},{type:"non_fast_forward"},{type:"pull_request",parameters:{required_approving_review_count:1,dismiss_stale_reviews_on_push:true,require_code_owner_review:false,require_last_push_approval:true,required_review_thread_resolution:true}}]}')"

rulesets="$(api GET "/repos/${owner}/${repo}/rulesets")"
ruleset_id="$(jq -r --arg name "${ruleset_name}" '.[] | select(.name == $name) | .id' <<<"${rulesets}" | head -1)"
if [[ -n "${ruleset_id}" ]]; then
  api PUT "/repos/${owner}/${repo}/rulesets/${ruleset_id}" "${payload}" >/dev/null
  echo "Updated GitHub ruleset ${ruleset_name} (${ruleset_id})"
else
  created="$(api POST "/repos/${owner}/${repo}/rulesets" "${payload}")"
  echo "Created GitHub ruleset ${ruleset_name} ($(jq -r '.id' <<<"${created}"))"
fi
