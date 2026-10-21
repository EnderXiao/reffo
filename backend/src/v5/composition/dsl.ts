import { createHash } from 'node:crypto'
import { z } from 'zod'
import type {
  ResumeEvidenceBundle,
  ValidationIssue,
  ValidationResult,
  V5ResumePlan,
} from '@/v5/types'
import type { CompositionBlueprint, P06CompositionOutput } from '@/v5/composition/contract'
import { deriveEvidenceAssemblies } from '@/v5/composition/evidence-assembly'
import {
  normalizeCompositionDisplayText,
  validateComposition,
} from '@/v5/composition/validator'
import { areCanonicalAdjacentSourceAtoms } from '@/v5/composition/source-continuation'
import { sourceBusinessDisplayText } from '@/v5/composition/source-display'

export const P06_DSL_CONTRACT_VERSION = 'p06-dsl-v1' as const

const emitAtomOperationSchema = z.object({
  op: z.literal('emit_atom'),
  evidenceId: z.string().trim().min(1),
}).strict()

export const p06DslBlockSchema = z.object({
  slotId: z.string().trim().min(1),
  operations: z.array(emitAtomOperationSchema).min(1).max(32),
  joiner: z.enum(['none', 'semicolon', 'source_concat']),
}).strict()

export const p06DslOutputSchema = z.object({
  contractVersion: z.literal(P06_DSL_CONTRACT_VERSION),
  blocks: z.array(p06DslBlockSchema),
}).strict()

export type P06DslOutput = z.infer<typeof p06DslOutputSchema>

export class P06DslValidationError extends Error {
  readonly code = 'P06_DSL_VALIDATION_FAILED' as const

  constructor(readonly issues: ValidationIssue[]) {
    super('P06D 受控 DSL 未通过服务端确定性校验。')
    this.name = 'P06DslValidationError'
  }
}

function issue(input: {
  code: string
  outputPath: string | null
  message: string
  expectedConstraint: string
  evidenceIds?: string[]
}): ValidationIssue {
  const issueId = createHash('sha256')
    .update([input.code, input.outputPath ?? '', input.message].join('|'))
    .digest('hex')
    .slice(0, 16)
  return {
    issueId: `issue_${issueId}`,
    severity: 'error',
    code: input.code,
    outputPath: input.outputPath,
    claimId: null,
    evidenceIds: input.evidenceIds ?? [],
    requirementIds: [],
    message: input.message,
    expectedConstraint: input.expectedConstraint,
    replacementText: null,
  }
}

/**
 * Replays a model-selected operation list into the transitional Composition
 * contract. The model never supplies candidate-facing text in this path.
 */
export function materializeDslComposition(input: {
  dsl: unknown
  blueprint: CompositionBlueprint
  resume: ResumeEvidenceBundle
  plan: V5ResumePlan
}): ValidationResult<P06CompositionOutput> {
  const parsed = p06DslOutputSchema.safeParse(input.dsl)
  if (!parsed.success) {
    return {
      passed: false,
      issues: parsed.error.issues.slice(0, 20).map(item => issue({
        code: 'DSL_SCHEMA_INVALID',
        outputPath: item.path.join('.') || null,
        message: item.message,
        expectedConstraint: 'P06 DSL 必须严格符合 p06-dsl-v1 且不得包含自由文本或未知字段',
      })),
    }
  }

  const evidence = new Map(input.resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const slotById = new Map(input.blueprint.slots.map(slot => [slot.slotId, slot]))
  const completedBlocks = structuredClone(parsed.data.blocks)
  const bodyUsed = new Set(completedBlocks.flatMap(block => (
    slotById.get(block.slotId)?.kind !== 'summary'
      ? block.operations.map(operation => operation.evidenceId) : []
  )))
  for (const evidenceId of input.blueprint.requiredBodyEvidenceIds) {
    if (bodyUsed.has(evidenceId)) continue
    const destinations = input.blueprint.slots.filter(slot => (
      slot.kind !== 'summary' && slot.allowedEvidenceIds.includes(evidenceId)
    ))
    // Position within one proven scope is presentation, not new evidence.
    // Never choose between different sections/scopes on behalf of the model.
    if (destinations.length === 0 || destinations.some(slot => (
      slot.scopeId !== destinations[0].scopeId || slot.sectionKey !== destinations[0].sectionKey
      || slot.kind !== destinations[0].kind
    ))) continue
    const sourcePosition = evidence.get(evidenceId)?.sourceSpan.start ?? 0
    const distance = (slotId: string) => {
      const block = completedBlocks.find(item => item.slotId === slotId)
      if (!block) return -1
      return Math.min(...block.operations.map(operation => (
        Math.abs((evidence.get(operation.evidenceId)?.sourceSpan.start ?? Infinity) - sourcePosition)
      )))
    }
    destinations.sort((a, b) => distance(a.slotId) - distance(b.slotId) || a.order - b.order)
    const slot = destinations[0]
    const existing = completedBlocks.filter(block => block.slotId === slot.slotId)
    if (existing.length > 1) continue
    if (existing.length === 0) {
      completedBlocks.push({ slotId: slot.slotId, operations: [{ op: 'emit_atom', evidenceId }], joiner: 'none' })
    } else {
      const block = existing[0]
      if (block.operations.length >= 32
        || (block.operations.length === 1 && block.joiner !== 'none')
        || (block.operations.length > 1 && block.joiner === 'none')) continue
      block.operations.push({ op: 'emit_atom', evidenceId })
      block.joiner = 'semicolon'
    }
    bodyUsed.add(evidenceId)
  }
  const companionAssemblyByAnchor = new Map(deriveEvidenceAssemblies(input.resume, input.plan)
    .filter(assembly => assembly.kind.startsWith('companion_'))
    .map(assembly => [assembly.anchorEvidenceId, assembly]))
  const replayIssues: ValidationIssue[] = []
  const blocks = completedBlocks.flatMap((block, index) => {
    const selectedEvidenceIds = block.operations.map(operation => operation.evidenceId)
    const selectedAtoms = selectedEvidenceIds.map(id => evidence.get(id))
    const unknownIds = selectedEvidenceIds.filter((_, atomIndex) => !selectedAtoms[atomIndex])
    if (unknownIds.length > 0) {
      replayIssues.push(issue({
        code: 'DSL_UNKNOWN_EVIDENCE',
        outputPath: `blocks[${index}].operations`,
        message: 'P06 DSL 引用了当前证据目录中不存在的 evidenceId。',
        expectedConstraint: 'emit_atom 只能引用服务端 Blueprint 允许的 EvidenceAtom',
        evidenceIds: unknownIds,
      }))
      return []
    }
    if (
      (selectedEvidenceIds.length === 1 && block.joiner !== 'none')
      || (selectedEvidenceIds.length > 1 && block.joiner === 'none')
    ) {
      replayIssues.push(issue({
        code: 'DSL_JOINER_MISMATCH',
        outputPath: `blocks[${index}].joiner`,
        message: 'P06 DSL 的 joiner 与 emit_atom 数量不一致。',
        expectedConstraint: '单一 atom 使用 none；多个 atom 使用 semicolon，或在严格满足相邻续行条件时使用 source_concat',
        evidenceIds: selectedEvidenceIds,
      }))
      return []
    }
    const slot = slotById.get(block.slotId)
    const companionAssembly = (slot?.kind === 'business_bullet' || slot?.kind === 'summary') && selectedEvidenceIds.length === 1
      ? companionAssemblyByAnchor.get(selectedEvidenceIds[0])
      : undefined
    const evidenceIds = companionAssembly?.memberEvidenceIds ?? selectedEvidenceIds
    const atoms = evidenceIds.map(id => evidence.get(id))
    const knownAtoms = atoms.filter((atom): atom is NonNullable<typeof atom> => Boolean(atom))
    const effectiveJoiner = companionAssembly?.joiner ?? block.joiner
    if (effectiveJoiner === 'source_concat' && !areCanonicalAdjacentSourceAtoms(knownAtoms)) {
      replayIssues.push(issue({
        code: 'DSL_SOURCE_CONCAT_NOT_ADJACENT',
        outputPath: `blocks[${index}].joiner`,
        message: 'P06 DSL 请求无分隔拼接，但引用证据不满足服务端的安全续行证明。',
        expectedConstraint: 'source_concat 仅允许安全业务证据在同文档、同 scope、Bxxxx 块号连续、sourceSpan 仅隔一个换行或服务端已证明的排版空白，且相邻文本边界可确定性闭合',
        evidenceIds,
      }))
      return []
    }
    const text = atoms
      .map(atom => ['responsibility', 'action', 'deliverable', 'result'].includes(atom!.claimType)
        ? sourceBusinessDisplayText(atom!.verbatimText) : normalizeCompositionDisplayText(atom!.verbatimText))
      .join(effectiveJoiner === 'semicolon' ? '；' : '')
      .replace(/[。；;]\s*[；;]/gu, '；')
    return [{ slotId: block.slotId, evidenceIds, text }]
  })

  if (replayIssues.length > 0) return { passed: false, issues: replayIssues }

  return validateComposition({
    composition: {
      contractVersion: input.blueprint.contractVersion,
      blocks,
    },
    blueprint: input.blueprint,
    resume: input.resume,
    plan: input.plan,
  })
}
