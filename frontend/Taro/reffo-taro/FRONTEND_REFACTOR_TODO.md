# Frontend Refactor TODO

This document tracks the scoped refactor plan for the Taro frontend. Keep each batch small, verify it, then stop for review before continuing.

## Scope Rules

- Do not change business state flow, API contracts, routing, or persistence behavior unless a task explicitly requires it.
- Prefer existing page behavior and tests over visual rewrites.
- Move repeated visual values toward `src/styles/tokens.ts`.
- Split large page components by responsibility: layout, state-specific panels, glyph/visual primitives, and styles.
- After each batch, run targeted tests and report any unrelated existing failures separately.

## Current Baseline

- `src/styles/tokens.ts` exists as the RN-side design token entry point.
- `src/pages/create/steps/JobDescriptionStep.tsx` has been split into smaller components.
- `src/pages/create/steps/JobDescriptionStep.styles.ts` owns the JD step styles.
- Targeted create page test suite passes after the first split.

## TODO

- [x] 1. Establish refactor baseline
  - [x] Record the current `JobDescriptionStep` split structure.
  - [x] Add RN-side design token entry point.
  - [x] Keep business state, API, and route behavior unchanged.

- [x] 2. Refactor `ResumeUploadStep`
  - [x] Split upload mode switch, file status panel, and Markdown input area.
  - [x] Move styles into `ResumeUploadStep.styles.ts`.
  - [x] Replace obvious hardcoded colors, radius, typography, and shadows with `tokens.ts`.
  - [x] Preserve existing create page test behavior.

- [x] 3. Refactor `AnalysisStage`
  - [x] Split animation constants, card visual structure, and copy/detail area.
  - [x] Move styles into `AnalysisStage.styles.ts`.
  - [x] Keep the current animation behavior; do not rewrite motion in this batch.

- [x] 4. Extract create-flow shared components
  - [x] Extract `StepTitle` or equivalent title segment renderer.
  - [x] Extract primary action button styling/structure.
  - [x] Extract reusable step panel/card structure if duplication remains after steps are split.
  - [x] Reduce repeated compact-layout branching in `PageView.tsx`.

- [x] 5. Verification per batch
  - [x] Run `npm test -- --runInBand src/pages/create/__tests__/index.test.tsx`.
  - [x] Run targeted TypeScript screening for changed files.
  - [x] Record unrelated full-repo `tsc` failures separately instead of fixing them in the same batch.

## Verification Notes

- Targeted create-page Jest suite passes: `npm test -- --runInBand src/pages/create/__tests__/index.test.tsx`.
- Targeted TypeScript screening for this refactor scope has no output:
  - `src/pages/create/PageView`
  - `src/pages/create/components/(Create|Analysis)*`
  - `src/pages/create/steps/(Resume|JobDescription)*`
  - `src/styles/tokens`
- Full-repo `npx tsc --noEmit --pretty false` still fails with existing unrelated issues. The latest run exited with code `2` and produced 278 log lines.

### Full `tsc` Failure Summary

- Test DOM typings are missing for component tests:
  - `src/components/business/JDInput/__tests__/index.test.tsx`
  - `src/components/business/ResumeUploader/__tests__/index.test.tsx`
- Jest mock typing issues dominate utility/store tests, mostly `TS2345` and `TS18046`:
  - `src/utils/__tests__/retry.test.ts`
  - `src/utils/__tests__/storage.test.ts`
  - `src/utils/__tests__/request.test.ts`
  - `src/store/__tests__/historyStore.test.ts`
- Existing domain type drift appears in JD store tests:
  - `src/store/__tests__/jdStore.test.ts`
  - Unknown fields include `skill_score` and `experience_score`.
- Existing API/client typing issues remain:
  - `src/services/api.ts` has duplicate `request` identifiers.
  - `src/services/__tests__/api.test.ts` accesses private `request`.
- Node/process typings are missing in existing files:
  - `src/components/ErrorBoundary/index.tsx`
  - `src/services/api.ts`
- Existing Taro callback result typings are too narrow in navigation/storage helpers:
  - `src/utils/__tests__/navigation.test.ts`
  - `src/utils/storage.ts`
  - `src/utils/navigation.example.ts`

No full `tsc` failures were reported under the create-flow refactor files listed above.

## Stop Point

Item 4 is complete. Next batch should be explicitly defined before continuing; the original scoped create-flow refactor checklist is complete except for any separate follow-up cleanup you request.
