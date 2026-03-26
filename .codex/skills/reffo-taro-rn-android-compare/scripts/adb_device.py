#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


DEFAULT_COMPONENT = "com.tarodemo/.MainActivity"


def run_command(command: list[str], *, text: bool = True, check: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run(command, check=False, text=text, capture_output=True)
    if check and result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or f"Command failed: {' '.join(command)}"
        raise SystemExit(message)
    return result


def adb_devices() -> list[dict[str, Any]]:
    output = run_command(["adb", "devices", "-l"]).stdout.splitlines()
    devices: list[dict[str, Any]] = []

    for line in output[1:]:
        stripped = line.strip()
        if not stripped or stripped.startswith("*"):
            continue
        parts = stripped.split()
        if len(parts) < 2:
            continue
        record: dict[str, Any] = {"serial": parts[0], "state": parts[1]}
        for token in parts[2:]:
            if ":" in token:
                key, value = token.split(":", 1)
                record[key] = value
            else:
                record.setdefault("extra", []).append(token)
        devices.append(record)

    return devices


def resolve_serial(requested: str | None) -> str:
    devices = adb_devices()
    healthy = [device for device in devices if device.get("state") == "device"]

    if requested:
        matches = [device for device in devices if device.get("serial") == requested]
        if not matches:
            raise SystemExit(f"Device '{requested}' not found. Use `list` to inspect available devices.")
        if matches[0].get("state") != "device":
            raise SystemExit(f"Device '{requested}' is not usable (state={matches[0].get('state')}).")
        return requested

    if len(healthy) == 1:
        return healthy[0]["serial"]

    if not healthy:
        raise SystemExit("No usable adb devices found.")

    serials = ", ".join(device["serial"] for device in healthy)
    raise SystemExit(f"Multiple usable devices found: {serials}. Pass --serial explicitly.")


def adb_command(serial: str, *parts: str, text: bool = True, check: bool = True) -> subprocess.CompletedProcess:
    return run_command(["adb", "-s", serial, *parts], text=text, check=check)


def print_devices(as_json: bool) -> None:
    devices = adb_devices()
    if as_json:
        print(json.dumps(devices, ensure_ascii=False, indent=2))
        return

    if not devices:
        print("No adb devices found.")
        return

    headers = ["serial", "state", "model", "device", "transport_id"]
    rows = []
    for device in devices:
        rows.append([str(device.get(column, "")) for column in headers])

    widths = [max(len(header), *(len(row[index]) for row in rows)) for index, header in enumerate(headers)]
    header_row = "  ".join(header.ljust(widths[index]) for index, header in enumerate(headers))
    print(header_row)
    print("  ".join("-" * width for width in widths))
    for row in rows:
        print("  ".join(cell.ljust(widths[index]) for index, cell in enumerate(row)))


def escape_text(value: str) -> str:
    return value.replace(" ", "%s")


def write_screenshot(serial: str, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as handle:
        result = subprocess.run(["adb", "-s", serial, "exec-out", "screencap", "-p"], check=False, stdout=handle, stderr=subprocess.PIPE)
    if result.returncode != 0:
        output.unlink(missing_ok=True)
        message = result.stderr.decode("utf-8", errors="ignore").strip() or "adb screenshot failed"
        raise SystemExit(message)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Common adb helpers for the Reffo RN Android workflow.")
    parser.add_argument("--serial", help="adb device serial; auto-select when exactly one healthy device exists")

    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list", help="List adb devices")
    list_parser.add_argument("--json", action="store_true", help="Print device information as JSON")

    launch_parser = subparsers.add_parser("launch", help="Launch the Reffo Android activity")
    launch_parser.add_argument("--component", default=DEFAULT_COMPONENT, help="Android component name")

    tap_parser = subparsers.add_parser("tap", help="Tap screen coordinates")
    tap_parser.add_argument("x", type=int)
    tap_parser.add_argument("y", type=int)

    swipe_parser = subparsers.add_parser("swipe", help="Swipe across the screen")
    swipe_parser.add_argument("x1", type=int)
    swipe_parser.add_argument("y1", type=int)
    swipe_parser.add_argument("x2", type=int)
    swipe_parser.add_argument("y2", type=int)
    swipe_parser.add_argument("--duration", type=int, default=300)

    text_parser = subparsers.add_parser("text", help="Input simple text")
    text_parser.add_argument("value")

    keyevent_parser = subparsers.add_parser("keyevent", help="Send an Android keyevent")
    keyevent_parser.add_argument("value")

    screenshot_parser = subparsers.add_parser("screenshot", help="Capture a PNG screenshot")
    screenshot_parser.add_argument("--output", required=False, help="Output PNG path")

    shell_parser = subparsers.add_parser("shell", help="Run an arbitrary adb shell command")
    shell_parser.add_argument("args", nargs=argparse.REMAINDER)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "list":
        print_devices(args.json)
        return 0

    serial = resolve_serial(args.serial)

    if args.command == "launch":
        result = adb_command(serial, "shell", "am", "start", "-n", args.component)
        sys.stdout.write(result.stdout)
        return 0

    if args.command == "tap":
        adb_command(serial, "shell", "input", "tap", str(args.x), str(args.y))
        print(f"Tapped {args.x},{args.y} on {serial}")
        return 0

    if args.command == "swipe":
        adb_command(
            serial,
            "shell",
            "input",
            "swipe",
            str(args.x1),
            str(args.y1),
            str(args.x2),
            str(args.y2),
            str(args.duration),
        )
        print(f"Swiped {args.x1},{args.y1} -> {args.x2},{args.y2} on {serial}")
        return 0

    if args.command == "text":
        adb_command(serial, "shell", "input", "text", escape_text(args.value))
        print(f"Sent text to {serial}")
        return 0

    if args.command == "keyevent":
        adb_command(serial, "shell", "input", "keyevent", args.value)
        print(f"Sent keyevent {args.value} to {serial}")
        return 0

    if args.command == "screenshot":
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        destination = Path(args.output) if args.output else Path(f"device-{serial}-{timestamp}.png")
        write_screenshot(serial, destination)
        print(destination)
        return 0

    if args.command == "shell":
        if not args.args:
            raise SystemExit("Provide the shell arguments after `shell`.")
        result = adb_command(serial, "shell", *args.args)
        sys.stdout.write(result.stdout)
        return 0

    raise SystemExit(f"Unsupported command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
