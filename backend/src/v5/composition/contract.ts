import { z } from 'zod'
import type { GeneratedResumeArtifact } from '@/v5/types'

export const P06_COMPOSITION_CONTRACT_VERSION = 'p06-composition-v1' as const
export const P06_COMPOSITION_COMPILER_VERSION = 'p06-composition-compiler-v2' as const

export type CompositionSectionKey =
  | 'summary'
  | 'experience'
  | 'project'
  | 'research'
  | 'education'
  | 'skills'
  | 'portfolio'
  | 'certifications'
  | 'languages'
  | 'publications'
  | 'patents'
  | 'awards'
  | 'other'

export type CompositionSlotKind = 'summary' | 'business_bullet' | 'skill' | 'ancillary'

/**
 * Server-owned rendering slot. The model may choose content only within the
 * evidence boundary; it cannot choose section, scope, path, or document order.
 */
export interface CompositionBlueprintSlot {
  slotId: string
  kind: CompositionSlotKind
  sectionKey: CompositionSectionKey
  scopeId: string | null
  outputPath: string
  order: number
  required: boolean
  allowedEvidenceIds: string[]
}

export interface CompositionBlueprint {
  contractVersion: typeof P06_COMPOSITION_CONTRACT_VERSION
  outputLanguage: string
  sectionOrder: CompositionSectionKey[]
  requiredBodyEvidenceIds: string[]
  slots: CompositionBlueprintSlot[]
}

/**
 * Transitional P06 output. `text` is deliberately a single unrendered line:
 * Markdown markers and all audit metadata are added by the server compiler.
 */
export const p06CompositionBlockSchema = z.object({
  slotId: z.string().trim().min(1),
  evidenceIds: z.array(z.string().trim().min(1)).min(1),
  text: z.string().trim().min(1),
}).strict()

export const p06CompositionOutputSchema = z.object({
  contractVersion: z.literal(P06_COMPOSITION_CONTRACT_VERSION),
  blocks: z.array(p06CompositionBlockSchema),
}).strict()

export type P06CompositionBlock = z.infer<typeof p06CompositionBlockSchema>
export type P06CompositionOutput = z.infer<typeof p06CompositionOutputSchema>

export interface CompositionCompileDiagnostics {
  contractVersion: typeof P06_COMPOSITION_CONTRACT_VERSION
  compilerVersion: typeof P06_COMPOSITION_COMPILER_VERSION
  degradedSlotIds: string[]
}

export interface CompositionCompileResult {
  artifact: GeneratedResumeArtifact
  diagnostics: CompositionCompileDiagnostics
}
