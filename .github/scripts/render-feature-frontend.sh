#!/usr/bin/env bash
set -euo pipefail

required=(RENDER_API_KEY RENDER_OWNER_ID RENDER_FEATURE_BRANCH RENDER_FEATURE_ACTION)
for key in "${required[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "missing required environment variable: ${key}" >&2
    exit 1
  fi
done

api_base="https://api.render.com/v1"
repo_url="${RENDER_REPO_URL:-https://github.com/${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}}"
service_prefix="${RENDER_FEATURE_FRONTEND_SERVICE_PREFIX:-reffo-feature-web}"
branch="${RENDER_FEATURE_BRANCH}"
action="${RENDER_FEATURE_ACTION}"
root_dir="${RENDER_FEATURE_FRONTEND_ROOT_DIR:-frontend/Taro/reffo-taro}"
build_command="${RENDER_FEATURE_FRONTEND_BUILD_COMMAND:-corepack pnpm@10.33.2 install --frozen-lockfile && corepack pnpm@10.33.2 build:h5:nonprod}"
publish_path="${RENDER_FEATURE_FRONTEND_PUBLISH_PATH:-dist}"

slug="$(printf '%s' "${branch#feature/}" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
slug="${slug:-root}"
slug="${slug:0:36}"
branch_hash="$(printf '%s' "${branch}" | sha256sum | cut -c1-8)"
service_name="${service_prefix}-${slug}-${branch_hash}"
backend_service_name="reffo-feature-${slug}-${branch_hash}"
backend_url="${RENDER_FEATURE_BACKEND_URL:-https://${backend_service_name}.onrender.com/api/v1}"

api() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local response_file
  response_file="$(mktemp)"
  local status

  if [[ -n "${body}" ]]; then
    status="$(curl -fsS -o "${response_file}" -w '%{http_code}' \
      -X "${method}" "${api_base}${path}" \
      -H "Authorization: Bearer ${RENDER_API_KEY}" \
      -H 'Content-Type: application/json' \
      --data "${body}" || true)"
  else
    status="$(curl -fsS -o "${response_file}" -w '%{http_code}' \
      -X "${method}" "${api_base}${path}" \
      -H "Authorization: Bearer ${RENDER_API_KEY}" || true)"
  fi

  if [[ "${status}" -lt 200 || "${status}" -ge 300 ]]; then
    echo "Render API ${method} ${path} failed with HTTP ${status}" >&2
    sed -n '1,8p' "${response_file}" >&2
    rm -f "${response_file}"
    exit 1
  fi

  cat "${response_file}"
  rm -f "${response_file}"
}

encoded_name="$(jq -rn --arg value "${service_name}" '$value|@uri')"
services="$(api GET "/services?ownerId=${RENDER_OWNER_ID}&name=${encoded_name}&limit=20")"
service_id="$(jq -r --arg name "${service_name}" '.. | objects | select(.name? == $name and .id? != null) | .id' <<<"${services}" | head -1)"

case "${action}" in
  deploy)
    commit_sha="${RENDER_COMMIT_SHA:-${GITHUB_SHA:?RENDER_COMMIT_SHA or GITHUB_SHA is required}}"
    env_vars="${RENDER_FEATURE_FRONTEND_ENV_VARS_JSON:-[] }"
    if ! jq -e 'type == "array"' >/dev/null 2>&1 <<<"${env_vars}"; then
      echo 'RENDER_FEATURE_FRONTEND_ENV_VARS_JSON must be a JSON array' >&2
      exit 1
    fi
    env_vars="$(jq --arg apiBaseUrl "${backend_url}" \
      '[.[] | select(.key != "PORT" and .key != "HOST" and .key != "API_BASE_URL")]
       + [{key:"REFFO_ENV",value:"nonprod"},{key:"API_BASE_URL",value:$apiBaseUrl}]' <<<"${env_vars}")"

    if [[ -z "${service_id}" ]]; then
      payload="$(jq -cn \
        --arg type 'static_site' \
        --arg name "${service_name}" \
        --arg ownerId "${RENDER_OWNER_ID}" \
        --arg repo "${repo_url}" \
        --arg branch "${branch}" \
        --arg rootDir "${root_dir}" \
        --arg buildCommand "${build_command}" \
        --arg publishPath "${publish_path}" \
        --argjson envVars "${env_vars}" \
        '{type:$type,name:$name,ownerId:$ownerId,repo:$repo,branch:$branch,autoDeploy:"no",rootDir:$rootDir,envVars:$envVars,serviceDetails:{buildCommand:$buildCommand,publishPath:$publishPath,pullRequestPreviewsEnabled:"no",headers:[],previews:{}}}')"
      created="$(api POST '/services' "${payload}")"
      service_id="$(jq -r '.service.id // .id // empty' <<<"${created}")"
      if [[ -z "${service_id}" ]]; then
        echo 'Render API response did not contain created frontend service id' >&2
        exit 1
      fi
    else
      update_payload="$(jq -cn \
        --arg branch "${branch}" \
        --arg rootDir "${root_dir}" \
        --arg buildCommand "${build_command}" \
        --arg publishPath "${publish_path}" \
        '{branch:$branch,autoDeploy:"no",rootDir:$rootDir,serviceDetails:{buildCommand:$buildCommand,publishPath:$publishPath,pullRequestPreviewsEnabled:"no",headers:[],previews:{}}}')"
      api PATCH "/services/${service_id}" "${update_payload}" >/dev/null
      api PUT "/services/${service_id}/env-vars" "${env_vars}" >/dev/null
    fi

    deploy_payload="$(jq -cn --arg commitId "${commit_sha}" '{commitId:$commitId,clearCache:"do_not_clear"}')"
    deploy="$(api POST "/services/${service_id}/deploys" "${deploy_payload}")"
    deploy_id="$(jq -r '.id // empty' <<<"${deploy}")"
    echo "Render feature frontend ${service_name} deployed (service=${service_id}${deploy_id:+, deploy=${deploy_id}}; api=${backend_url})"
    ;;
  delete)
    if [[ -z "${service_id}" ]]; then
      echo "Render feature frontend ${service_name} already absent"
      exit 0
    fi
    api DELETE "/services/${service_id}" >/dev/null
    echo "Render feature frontend ${service_name} deleted"
    ;;
  *)
    echo "RENDER_FEATURE_ACTION must be deploy or delete" >&2
    exit 1
    ;;
esac
