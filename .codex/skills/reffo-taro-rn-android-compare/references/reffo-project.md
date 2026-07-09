# Reffo Taro RN Android project notes

## Default paths

- Repository root: `/Users/mi/code/reffo`
- RN project root: `/Users/mi/code/reffo/frontend/Taro/reffo-taro`
- Skill root: `/Users/mi/code/reffo/.codex/skills/reffo-taro-rn-android-compare`
- Suggested artifact root: `/Users/mi/code/reffo/.artifacts/reffo-rn-android`

## Runtime defaults

- Node requirement: `22.x`
- Package manager: `pnpm`
- Taro RN watch command: `pnpm dev:rn`
- Metro command: `pnpm start` (default port `8082`)
- Android install command: `pnpm exec react-native run-android`
- Figma token env: `FIGMA_ACCESS_TOKEN`

## Android app identity

- Application id: `com.tarodemo`
- Main activity: `com.tarodemo/.MainActivity`
- RN component name: `taroDemo`

These values come from:

- `frontend/Taro/reffo-taro/android/gradle.properties`
- `frontend/Taro/reffo-taro/android/app/src/main/java/com/tarodemo/MainActivity.kt`
- `frontend/Taro/reffo-taro/config/index.ts`

## Recommended artifact layout

Use one folder per checked screen:

```text
.artifacts/reffo-rn-android/
  <screen-name>/
    <timestamp>/
      design.png
      device.png
      metadata.json
      report.html
```

Example screen names:

- `index-empty-state`
- `index-history-list`
- `create-form`

## adb usage notes

- Start with `adb devices -l` and only use devices in `device` state.
- If there is more than one healthy device, always pass the serial explicitly.
- Prefer `adb exec-out screencap -p` for screenshots because it avoids an intermediate pull step.
- For text input, `adb shell input text` is reliable for simple ASCII strings and space-separated content. Avoid promising full Unicode support without verifying it.

## Figma link notes

- Prefer a Figma URL that already points to a frame or component and includes `node-id`.
- `scripts/build_compare_report.py --figma-url ...` fetches the design asset directly from Figma and writes it into the output directory before generating the report.
- The script reads the token from `FIGMA_ACCESS_TOKEN` by default, or from `--figma-token` / `--figma-token-env` when provided.
- Figma API access requires network permission in sandboxed Codex sessions.
- The script normalizes `node-id=3473-3082` into the API form `3473:3082` automatically.

## Visual QA checklist

Check these items before reporting a mismatch:

1. Is the screen state the same as the design state?
2. Is the device width or density different enough to explain responsive differences?
3. Are safe-area insets, status bar height, or keyboard visibility affecting layout?
4. Are placeholder data, loading states, or permission dialogs changing the screenshot?
5. Is the discrepancy structural, or only caused by dynamic content?
