#!/usr/bin/env python3

from __future__ import annotations

import argparse
import html
import json
import os
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlencode, unquote, urlparse
from urllib.request import Request, urlopen


FIGMA_API_BASE = "https://api.figma.com/v1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a local side-by-side HTML report for design QA.")
    design_source = parser.add_mutually_exclusive_group(required=True)
    design_source.add_argument("--design", help="Path to the exported design image")
    design_source.add_argument("--figma-url", help="Figma file/design URL that includes node-id")
    parser.add_argument("--figma-token", help="Figma access token; defaults to env var lookup")
    parser.add_argument(
        "--figma-token-env",
        default="FIGMA_ACCESS_TOKEN",
        help="Environment variable name used when --figma-token is omitted",
    )
    parser.add_argument("--figma-scale", type=float, default=2.0, help="Export scale for Figma images API")
    parser.add_argument(
        "--figma-format",
        choices=("png", "jpg", "svg"),
        default="png",
        help="Export format for Figma images API",
    )
    parser.add_argument("--screenshot", required=True, help="Path to the device screenshot")
    parser.add_argument("--output-dir", required=True, help="Directory for the generated report")
    parser.add_argument("--label", default="visual-check", help="Screen label shown in the report")
    parser.add_argument("--notes", default="", help="Optional notes recorded in the report")
    return parser.parse_args()


def image_dimensions(path: Path) -> dict[str, int | None]:
    try:
        result = subprocess.run(
            ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)],
            check=True,
            capture_output=True,
            text=True,
        )
        width = None
        height = None
        for line in result.stdout.splitlines():
            stripped = line.strip()
            if stripped.startswith("pixelWidth:"):
                width = int(stripped.split(":", 1)[1].strip())
            if stripped.startswith("pixelHeight:"):
                height = int(stripped.split(":", 1)[1].strip())
        return {"width": width, "height": height}
    except Exception:
        return {"width": None, "height": None}


def copy_asset(source: Path, output_dir: Path, prefix: str) -> Path:
    destination = output_dir / f"{prefix}{source.suffix.lower()}"
    if source.resolve() == destination.resolve():
        return destination
    shutil.copy2(source, destination)
    return destination


def normalize_node_id(raw_value: str) -> str:
    value = unquote(raw_value).strip()
    if ":" in value:
        return value
    if "-" in value:
        return value.replace("-", ":")
    return value


def parse_figma_url(figma_url: str) -> dict[str, str]:
    parsed = urlparse(figma_url)
    if "figma.com" not in parsed.netloc:
        raise SystemExit(f"Not a Figma URL: {figma_url}")

    path_parts = [part for part in parsed.path.split("/") if part]
    file_key = ""
    for index, part in enumerate(path_parts[:-1]):
        if part in {"design", "file", "proto"}:
            file_key = path_parts[index + 1]
            break

    if not file_key:
        raise SystemExit("Could not resolve the Figma file key from the URL.")

    query = parse_qs(parsed.query)
    node_id = query.get("node-id", [None])[0]
    if not node_id and parsed.fragment:
        fragment_query = parse_qs(parsed.fragment)
        node_id = fragment_query.get("node-id", [None])[0]

    if not node_id:
        raise SystemExit("Figma URL must include node-id. Use a frame or component link instead of the file homepage.")

    return {
        "url": figma_url,
        "file_key": file_key,
        "node_id": normalize_node_id(node_id),
    }


def require_figma_token(args: argparse.Namespace) -> str:
    if args.figma_token:
        return args.figma_token

    token = os.getenv(args.figma_token_env, "").strip()
    if token:
        return token

    raise SystemExit(
        f"Missing Figma access token. Set {args.figma_token_env} or pass --figma-token explicitly."
    )


def request_json(url: str, headers: dict[str, str]) -> dict[str, Any]:
    request = Request(url, headers=headers)
    try:
        with urlopen(request) as response:
            return json.load(response)
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="ignore").strip()
        detail = body or error.reason
        raise SystemExit(f"Figma API request failed ({error.code}): {detail}") from error
    except URLError as error:
        raise SystemExit(f"Network error while contacting Figma: {error.reason}") from error


def download_file(url: str, destination: Path) -> None:
    request = Request(url, headers={"User-Agent": "Codex Reffo RN Android Compare"})
    try:
        with urlopen(request) as response, destination.open("wb") as output_file:
            shutil.copyfileobj(response, output_file)
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="ignore").strip()
        detail = body or error.reason
        raise SystemExit(f"Failed to download the Figma image ({error.code}): {detail}") from error
    except URLError as error:
        raise SystemExit(f"Network error while downloading the Figma image: {error.reason}") from error


def fetch_figma_design(args: argparse.Namespace, output_dir: Path) -> tuple[Path, dict[str, Any]]:
    if not (0 < args.figma_scale <= 4):
        raise SystemExit("--figma-scale must be greater than 0 and at most 4.")

    figma_ref = parse_figma_url(args.figma_url)
    token = require_figma_token(args)
    headers = {
        "X-Figma-Token": token,
        "Accept": "application/json",
        "User-Agent": "Codex Reffo RN Android Compare",
    }

    node_query = urlencode({"ids": figma_ref["node_id"]})
    node_payload = request_json(
        f"{FIGMA_API_BASE}/files/{quote(figma_ref['file_key'], safe='')}/nodes?{node_query}",
        headers,
    )
    node_record = (node_payload.get("nodes") or {}).get(figma_ref["node_id"], {})
    document = node_record.get("document") or {}

    image_query = urlencode(
        {
            "ids": figma_ref["node_id"],
            "format": args.figma_format,
            "scale": str(args.figma_scale),
        }
    )
    image_payload = request_json(
        f"{FIGMA_API_BASE}/images/{quote(figma_ref['file_key'], safe='')}?{image_query}",
        headers,
    )
    image_url = (image_payload.get("images") or {}).get(figma_ref["node_id"])
    if not image_url:
        raise SystemExit(
            "Figma did not return an image URL for this node. Ensure the link points to a renderable frame or component."
        )

    destination = output_dir / f"design.{args.figma_format}"
    download_file(image_url, destination)

    metadata = {
        "design_source": "figma",
        "design_origin": figma_ref["url"],
        "figma_file_key": figma_ref["file_key"],
        "figma_node_id": figma_ref["node_id"],
        "figma_node_name": document.get("name"),
        "figma_node_type": document.get("type"),
    }
    return destination, metadata


def resolve_design_asset(args: argparse.Namespace, output_dir: Path) -> tuple[Path, dict[str, Any]]:
    if args.design:
        design = Path(args.design).expanduser().resolve()
        if not design.is_file():
            raise SystemExit(f"Design image not found: {design}")
        return copy_asset(design, output_dir, "design"), {
            "design_source": "local",
            "design_origin": str(design),
        }

    return fetch_figma_design(args, output_dir)


def render_html(metadata: dict[str, Any]) -> str:
    label = html.escape(str(metadata["label"]))
    notes = html.escape(str(metadata["notes"])) or "无"
    design_file = html.escape(str(metadata["design_file"]))
    screenshot_file = html.escape(str(metadata["screenshot_file"]))
    generated_at = html.escape(str(metadata["generated_at"]))
    design_source = html.escape(str(metadata.get("design_source", "unknown")))
    design_origin = html.escape(str(metadata.get("design_origin", ""))) or "无"
    figma_node_name = html.escape(str(metadata.get("figma_node_name") or "-"))
    figma_node_id = html.escape(str(metadata.get("figma_node_id") or "-"))
    design_size = metadata["design_size"]
    screenshot_size = metadata["screenshot_size"]
    design_size_text = f"{design_size['width']} × {design_size['height']}" if design_size["width"] and design_size["height"] else "unknown"
    screenshot_size_text = f"{screenshot_size['width']} × {screenshot_size['height']}" if screenshot_size["width"] and screenshot_size["height"] else "unknown"

    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{label} · Visual Compare</title>
  <style>
    :root {{
      color-scheme: dark;
      --bg: #0f172a;
      --panel: #111827;
      --muted: #94a3b8;
      --line: #334155;
    }}
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; background: var(--bg); color: #e2e8f0; font: 14px/1.5 -apple-system, BlinkMacSystemFont, sans-serif; }}
    main {{ max-width: 1200px; margin: 0 auto; padding: 24px; }}
    h1, h2 {{ margin: 0 0 12px; }}
    .meta, .grid {{ display: grid; gap: 16px; }}
    .meta {{ grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin-bottom: 24px; }}
    .card {{ background: rgba(17,24,39,.88); border: 1px solid var(--line); border-radius: 16px; padding: 16px; }}
    .k {{ color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }}
    .v {{ margin-top: 8px; word-break: break-word; }}
    .grid {{ grid-template-columns: 1fr 1fr; }}
    .frame {{ position: relative; min-height: 720px; border-radius: 16px; overflow: hidden; border: 1px solid var(--line); background:
      linear-gradient(45deg, #0b1220 25%, transparent 25%),
      linear-gradient(-45deg, #0b1220 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #0b1220 75%),
      linear-gradient(-45deg, transparent 75%, #0b1220 75%);
      background-size: 24px 24px;
      background-position: 0 0, 0 12px, 12px -12px, -12px 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }}
    .frame img {{ max-width: 100%; max-height: 100%; object-fit: contain; }}
    .overlay-base {{ position: relative; }}
    .overlay-top {{ position: absolute; inset: 0; margin: auto; opacity: .5; }}
    .controls {{ display: flex; align-items: center; gap: 12px; margin-top: 12px; flex-wrap: wrap; }}
    .controls input {{ width: 240px; }}
    code {{ color: #bae6fd; }}
    @media (max-width: 960px) {{ .grid {{ grid-template-columns: 1fr; }} }}
  </style>
</head>
<body>
  <main>
    <h1>{label}</h1>
    <div class="meta">
      <div class="card"><div class="k">Generated</div><div class="v">{generated_at}</div></div>
      <div class="card"><div class="k">Design source</div><div class="v">{design_source}</div></div>
      <div class="card"><div class="k">Design size</div><div class="v">{design_size_text}</div></div>
      <div class="card"><div class="k">Screenshot size</div><div class="v">{screenshot_size_text}</div></div>
      <div class="card"><div class="k">Figma node</div><div class="v">{figma_node_name} · {figma_node_id}</div></div>
      <div class="card"><div class="k">Notes</div><div class="v">{notes}</div></div>
    </div>

    <div class="card" style="margin-bottom: 24px;">
      <div class="k">Design origin</div>
      <div class="v">{design_origin}</div>
    </div>

    <div class="card" style="margin-bottom: 24px;">
      <h2>Overlay</h2>
      <div class="frame" id="overlay-frame">
        <img class="overlay-base" src="{design_file}" alt="Design image">
        <img class="overlay-top" id="overlay-image" src="{screenshot_file}" alt="Device screenshot">
      </div>
      <div class="controls">
        <label for="opacity">Screenshot opacity</label>
        <input id="opacity" type="range" min="0" max="100" value="50">
        <span id="opacity-value">50%</span>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <h2>Design</h2>
        <div class="frame"><img src="{design_file}" alt="Design image"></div>
      </div>
      <div class="card">
        <h2>Screenshot</h2>
        <div class="frame"><img src="{screenshot_file}" alt="Device screenshot"></div>
      </div>
    </div>
  </main>
  <script>
    const slider = document.getElementById('opacity');
    const overlay = document.getElementById('overlay-image');
    const output = document.getElementById('opacity-value');
    slider.addEventListener('input', () => {{
      const value = Number(slider.value) / 100;
      overlay.style.opacity = value.toString();
      output.textContent = `${{slider.value}}%`;
    }});
  </script>
</body>
</html>
"""


def main() -> int:
    args = parse_args()
    screenshot = Path(args.screenshot).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()

    if not screenshot.is_file():
        raise SystemExit(f"Screenshot image not found: {screenshot}")

    output_dir.mkdir(parents=True, exist_ok=True)

    design_copy, design_metadata = resolve_design_asset(args, output_dir)
    screenshot_copy = copy_asset(screenshot, output_dir, "device")

    metadata = {
        "label": args.label,
        "notes": args.notes,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "design_file": design_copy.name,
        "screenshot_file": screenshot_copy.name,
        "screenshot_original": str(screenshot),
        "design_size": image_dimensions(design_copy),
        "screenshot_size": image_dimensions(screenshot_copy),
        **design_metadata,
    }

    (output_dir / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "report.html").write_text(render_html(metadata), encoding="utf-8")

    print(output_dir / "report.html")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
