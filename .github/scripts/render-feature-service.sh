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
service_prefix="${RENDER_FEATURE_SERVICE_PREFIX:-reffo-feature}"
region="${RENDER_FEATURE_REGION:-oregon}"
plan="${RENDER_FEATURE_PLAN:-starter}"
root_dir="${RENDER_FEATURE_ROOT_DIR:-backend}"
dockerfile_path="${RENDER_FEATURE_DOCKERFILE:-Containerfile}"
health_path="${RENDER_FEATURE_HEALTH_PATH:-/api/v1/mvp/health}"
branch="${RENDER_FEATURE_BRANCH}"
action="${RENDER_FEATURE_ACTION}"

slug="$(printf '%s' "${branch#feature/}" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
slug="${slug:-root}"
slug="${slug:0:36}"
branch_hash="$(printf '%s' "${branch}" | sha256sum | cut -c1-8)"
service_name="${service_prefix}-${slug}-${branch_hash}"
frontend_service_name="${RENDER_FEATURE_FRONTEND_SERVICE_PREFIX:-reffo-feature-web}-${slug}-${branch_hash}"
frontend_origin="https://${frontend_service_name}.onrender.com"

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
    env_vars="${RENDER_FEATURE_ENV_VARS_JSON:-[] }"
    if ! jq -e 'type == "array"' >/dev/null 2>&1 <<<"${env_vars}"; then
      echo 'RENDER_FEATURE_ENV_VARS_JSON must be a JSON array' >&2
      exit 1
    fi
    # Render injects PORT for Web Services. Feature environments must never
    # inherit a Pro model or model fallback from the shared secret.
    env_vars="$(jq --arg frontendOrigin "${frontend_origin}" '
      [.[] | select(
        .key != "PORT"
        and .key != "HOST"
        and .key != "AI_MODEL"
        and .key != "AI_FALLBACK_MODELS"
        and .key != "CORS_ORIGIN"
      )]
      + [
        {key:"AI_MODEL",value:"deepseek-v4-flash"},
        {key:"AI_FALLBACK_MODELS",value:""},
        {key:"CORS_ORIGIN",value:$frontendOrigin}
      ]
    ' <<<"${env_vars}")"

    if [[ -z "${service_id}" ]]; then
      payload="$(jq -cn \
        --arg type 'web_service' \
        --arg name "${service_name}" \
        --arg ownerId "${RENDER_OWNER_ID}" \
        --arg repo "${repo_url}" \
        --arg branch "${branch}" \
        --arg rootDir "${root_dir}" \
        --arg region "${region}" \
        --arg plan "${plan}" \
        --arg dockerfilePath "${dockerfile_path}" \
        --arg healthCheckPath "${health_path}" \
        --argjson envVars "${env_vars}" \
        '{type:$type,name:$name,ownerId:$ownerId,repo:$repo,branch:$branch,autoDeploy:"no",rootDir:$rootDir,envVars:$envVars,serviceDetails:{runtime:"docker",plan:$plan,region:$region,healthCheckPath:$healthCheckPath,envSpecificDetails:{dockerfilePath:$dockerfilePath,dockerContext:"."}}}')"
      created="$(api POST '/services' "${payload}")"
      service_id="$(jq -r '.service.id // empty' <<<"${created}")"
      if [[ -z "${service_id}" ]]; then
        echo 'Render API response did not contain created service id' >&2
        exit 1
      fi
    else
      update_payload="$(jq -cn --arg branch "${branch}" '{branch:$branch,autoDeploy:"no"}')"
      api PATCH "/services/${service_id}" "${update_payload}" >/dev/null
      api PUT "/services/${service_id}/env-vars" "${env_vars}" >/dev/null
    fi

    deploy_payload="$(jq -cn --arg commitId "${commit_sha}" '{commitId:$commitId,clearCache:"do_not_clear"}')"
    deploy="$(api POST "/services/${service_id}/deploys" "${deploy_payload}")"
    deploy_id="$(jq -r '.id // empty' <<<"${deploy}")"
    echo "Render feature service ${service_name} deployed (service=${service_id}${deploy_id:+, deploy=${deploy_id}})"
    ;;
  delete)
    if [[ -z "${service_id}" ]]; then
      echo "Render feature service ${service_name} already absent"
      exit 0
    fi
    api DELETE "/services/${service_id}" >/dev/null
    echo "Render feature service ${service_name} deleted"
    ;;
  *)
    echo "RENDER_FEATURE_ACTION must be deploy or delete" >&2
    exit 1
    ;;
esac
