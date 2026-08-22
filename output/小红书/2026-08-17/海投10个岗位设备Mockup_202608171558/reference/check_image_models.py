#!/usr/bin/env python3
"""List image-capable-looking model IDs exposed by the configured xhs endpoint."""

from __future__ import annotations

import os
from pathlib import Path

import requests


ENV_FILE = Path("/Users/haishuanglong/.codex/skills/xhs-writer-skill/.env")


for raw_line in ENV_FILE.read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    os.environ.setdefault(key.strip(), value.strip().strip("\"").strip("'"))

base_url = os.environ["OPENAI_BASE_URL"].rstrip("/")
api_key = os.environ["OPENAI_API_KEY"]
response = requests.get(
    f"{base_url}/v1/models",
    headers={"Authorization": f"Bearer {api_key}"},
    timeout=60,
)
print(f"status={response.status_code}")
response.raise_for_status()
items = response.json().get("data") or []
model_ids = sorted(
    str(item.get("id", ""))
    for item in items
    if any(token in str(item.get("id", "")).lower() for token in ("image", "dall", "flux"))
)
print("image_models=" + (", ".join(model_ids) if model_ids else "none"))
