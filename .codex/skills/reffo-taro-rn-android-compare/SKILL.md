---
name: reffo-taro-rn-android-compare
description: Run the Reffo Taro React Native Android app, select a usable adb-connected device, drive the UI with adb input commands, capture on-device screenshots, and compare them against either local design images or Figma node links. Use when working on `frontend/Taro/reffo-taro` tasks such as RN Android startup, real-device verification, visual QA, screenshot collection, or design-vs-implementation checks.
---

# Reffo Taro RN Android Compare

## Overview

Run the Reffo Taro RN Android target on a real device, automate device interaction through adb, and generate local comparison artifacts for visual QA.

Keep the workflow rooted in this repository and prefer the bundled helpers instead of retyping adb command sequences.

Read `references/reffo-project.md` once at the start for repo-specific defaults such as project path, app id, package scripts, Figma token expectations, and artifact conventions.

## Quick Start

1. Run `python3 scripts/adb_device.py list` to inspect usable devices.
2. Run `bash scripts/run_rn_android.sh --device <serial>` to start `pnpm dev:rn`, `pnpm start`, and install the Android app.
3. Use `python3 scripts/adb_device.py launch|tap|swipe|text|keyevent` to reach the target UI state.
4. Capture a screenshot with `python3 scripts/adb_device.py screenshot --output <path>`.
5. Build a visual QA report with either:
   - `python3 scripts/build_compare_report.py --design <design.png> --screenshot <screen.png> --output-dir <dir>`
   - `python3 scripts/build_compare_report.py --figma-url '<figma-link-with-node-id>' --screenshot <screen.png> --output-dir <dir>`
6. Summarize mismatches and reference the generated artifact paths.

## Workflow

### 1. Verify prerequisites

- Work in `/Users/mi/code/reffo` and treat `frontend/Taro/reffo-taro` as the RN project root.
- Ensure `node -v` is `v22.x`, `pnpm` is available, and `adb devices -l` shows at least one device with state `device`.
- If multiple devices are connected, always pass `--serial` or `--device` explicitly.
- If the task uses a Figma link, ensure `FIGMA_ACCESS_TOKEN` is available or pass `--figma-token` explicitly.
- Ask for approval before installing dependencies, SDK components, or using networked Figma APIs.

### 2. Start the Reffo RN Android app

- Use `scripts/run_rn_android.sh` as the default entry point.
- Let the helper start or reuse the long-running `pnpm dev:rn` and `pnpm start` processes, then run `react-native run-android` for the chosen device.
- Check the log files under `.artifacts/reffo-rn-android/logs/` before deciding the build is stuck.
- Reuse existing watchers when they are healthy; avoid spawning duplicate Metro or Taro watch processes.

### 3. Select a device and drive it with adb

- Run `python3 scripts/adb_device.py list` first.
- Prefer devices with state `device`; reject `offline` and `unauthorized` devices.
- Use the helper subcommands instead of raw adb whenever possible:
  - `launch` to open `com.tarodemo/.MainActivity`
  - `tap` and `swipe` for navigation
  - `text` for simple ASCII text input
  - `keyevent` for back/home/enter and similar keys
  - `screenshot` to pull a PNG directly from the device
- Normalize the app state before comparing UI: unlock the device, dismiss system dialogs, and navigate to the intended screen.

### 4. Capture evidence

- Save comparison artifacts under `.artifacts/reffo-rn-android/<screen>/<timestamp>/`.
- Keep the fetched or local design asset and the device screenshot in the same artifact folder.
- Record the device serial, page name, route or state, and the adb steps used to reach the screen.
- If the user asks for an image in the Codex desktop app, surface the generated local file with an absolute Markdown image path or `view_image`.

### 5. Compare with the design

- Prefer `scripts/build_compare_report.py --figma-url ...` when the user provides a Figma node link and you have a usable token.
- Use `scripts/build_compare_report.py --design ...` when the user already has an exported PNG or JPG.
- Require the Figma URL to include `node-id`; otherwise ask for a frame or component link instead of the file homepage.
- Use the generated `report.html` and `metadata.json` for side-by-side and overlay inspection.
- Compare structure, spacing, alignment, safe area, color blocks, corner radius, typography scale, and clipped or overflowing content.

### 6. Report the result

- Summarize exact UI mismatches instead of saying “looks off”.
- Reference the generated artifact directory and the specific screenshot used.
- Separate real UI defects from intentional differences caused by mock data, device status bar, keyboard, or runtime permissions.
- If the design came from Figma, include the Figma link and resolved node id in the summary.

## Command Patterns

- List devices:

  `python3 scripts/adb_device.py list`

- Start the RN Android app on a chosen device:

  `bash scripts/run_rn_android.sh --device <serial>`

- Launch the app and tap a coordinate:

  `python3 scripts/adb_device.py --serial <serial> launch`

  `python3 scripts/adb_device.py --serial <serial> tap 540 1810`

- Capture a screenshot:

  `python3 scripts/adb_device.py --serial <serial> screenshot --output .artifacts/reffo-rn-android/index/20260307-220000/device.png`

- Build a comparison report from a local image:

  `python3 scripts/build_compare_report.py --design /absolute/path/to/design.png --screenshot .artifacts/reffo-rn-android/index/20260307-220000/device.png --output-dir .artifacts/reffo-rn-android/index/20260307-220000 --label index-empty-state`

- Build a comparison report directly from Figma:

  `FIGMA_ACCESS_TOKEN=*** python3 scripts/build_compare_report.py --figma-url 'https://www.figma.com/design/<file-key>/<name>?node-id=3473-3082' --screenshot .artifacts/reffo-rn-android/index/20260307-220000/device.png --output-dir .artifacts/reffo-rn-android/index/20260307-220000 --label index-empty-state`

## Resources

- `references/reffo-project.md`: Repo-specific defaults for this project.
- `scripts/run_rn_android.sh`: Start Taro watch, Metro, and Android installation with log files.
- `scripts/adb_device.py`: List devices and run common adb interactions.
- `scripts/build_compare_report.py`: Generate a local HTML comparison report from a local design asset or a Figma node link.

## Boundaries

- Do not take device screenshots unless the current task actually needs them.
- Do not guess tap coordinates across different devices; derive them from the current screenshot or explicit user instruction.
- Do not hit the Figma API without a token and network approval.
- Do not report a design defect without naming the screen, artifact path, and the visible discrepancy.
