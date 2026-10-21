import { createHash } from 'node:crypto'
import type {
  EvidenceAtom,
  ResumeEvidenceBundle,
  ValidationIssue,
  ValidationResult,
  V5ResumePlan,
} from '@/v5/types'
import { plannedContentEvidenceIds } from '@/v5/validators'
import {
  P06_COMPOSITION_CONTRACT_VERSION,
  p06CompositionOutputSchema,
  type CompositionBlueprint,
  type CompositionBlueprintSlot,
  type P06CompositionBlock,
  type P06CompositionOutput,
} from '@/v5/composition/contract'
import { areCanonicalAdjacentSourceAtoms } from '@/v5/composition/source-continuation'
import { deriveEvidenceAssemblies } from '@/v5/composition/evidence-assembly'
import { sourceBusinessDisplayText } from '@/v5/composition/source-display'

export { areCanonicalAdjacentSourceAtoms } from '@/v5/composition/source-continuation'

const BUSINESS_CLAIM_TYPES = new Set<EvidenceAtom['claimType']>([
  'responsibility',
  'action',
  'deliverable',
  'result',
])

const ANCILLARY_TYPE_BY_SECTION: Partial<Record<CompositionBlueprintSlot['sectionKey'], EvidenceAtom['claimType']>> = {
  certifications: 'certification',
  languages: 'language',
  publications: 'publication',
  patents: 'patent',
  awards: 'award',
  portfolio: 'portfolio_link',
}

export class CompositionBlueprintFeasibilityError extends Error {
  readonly code = 'P06_COMPOSITION_BLUEPRINT_INFEASIBLE' as const

  constructor(readonly issues: ValidationIssue[]) {
    super('P06 Composition Blueprint 无法由当前计划和安全证据完整填充。')
    this.name = 'CompositionBlueprintFeasibilityError'
  }
}

function issue(input: {
  code: string
  message: string
  expectedConstraint: string
  severity?: ValidationIssue['severity']
  outputPath?: string | null
  evidenceIds?: string[]
}) : ValidationIssue {
  const outputPath = input.outputPath ?? null
  const issueId = createHash('sha256')
    .update([input.code, outputPath ?? '', input.message].join('|'))
    .digest('hex')
    .slice(0, 16)
  return {
    issueId: `issue_${issueId}`,
    severity: input.severity ?? 'error',
    code: input.code,
    outputPath,
    claimId: null,
    evidenceIds: input.evidenceIds ?? [],
    requirementIds: [],
    message: input.message,
    expectedConstraint: input.expectedConstraint,
    replacementText: null,
  }
}

function duplicates(values: string[]) {
  const seen = new Set<string>()
  const result = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) result.add(value)
    seen.add(value)
  }
  return [...result]
}

function sameSet(left: string[], right: string[]) {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  return leftSet.size === rightSet.size && [...leftSet].every(value => rightSet.has(value))
}

export function normalizeCompositionDisplayText(value: string) {
  return value.trim().replace(/^(?:#{1,6}|[-*+])\s+/, '').trim()
}

function proofDisplayText(value: string, slot: CompositionBlueprintSlot, atom?: EvidenceAtom) {
  let normalized = normalizeCompositionDisplayText(value)
  if (slot.kind === 'skill' || atom?.claimType === 'skill') {
    normalized = normalized.replace(/^(?:专业技能|技能|skills?)\s*[:：]\s*/i, '').trim()
  }
  return normalized
}

export function canonicalCompositionProofText(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    // Preserve symbols that carry numeric range, sign, percentage, or
    // technology semantics. `400+` must never prove `400`, nor `C++` prove `C`.
    .replace(/[^\p{L}\p{N}+<>≥≤~≈%％&/\-]+/gu, '')
}

export function isSourceProvenCompositionText(input: {
  block: P06CompositionBlock
  slot: CompositionBlueprintSlot
  atoms: EvidenceAtom[]
}) {
  const displayed = proofDisplayText(input.block.text, input.slot, input.atoms[0])
  const output = canonicalCompositionProofText(displayed)
  const sources = input.atoms.map(atom => (
    canonicalCompositionProofText(proofDisplayText(atom.verbatimText, input.slot, atom))
  ))
  if (!output || sources.length === 0 || sources.some(source => !source)) return false
  const displaySources = input.atoms.map(atom => canonicalCompositionProofText(
    BUSINESS_CLAIM_TYPES.has(atom.claimType) ? sourceBusinessDisplayText(atom.verbatimText)
      : proofDisplayText(atom.verbatimText, input.slot, atom)
  ))
  if (sources.length === 1) return output === sources[0] || output === displaySources[0]
  const hasSemicolonBoundaries = (displayed.match(/[；;]/g) ?? []).length >= sources.length - 1
  if (!hasSemicolonBoundaries && !areCanonicalAdjacentSourceAtoms(input.atoms)) return false
  return output === sources.join('') || output === displaySources.join('')
}

function claimTypesMatchSlot(slot: CompositionBlueprintSlot, atoms: EvidenceAtom[]) {
  if (slot.kind === 'summary' || slot.kind === 'business_bullet') {
    return atoms.every(atom => BUSINESS_CLAIM_TYPES.has(atom.claimType))
  }
  if (slot.kind === 'skill') return atoms.every(atom => atom.claimType === 'skill')
  if (slot.sectionKey === 'education') {
    return atoms.every(atom => ['education', 'award', 'result'].includes(atom.claimType))
  }
  const expected = ANCILLARY_TYPE_BY_SECTION[slot.sectionKey]
  return expected ? atoms.every(atom => atom.claimType === expected) : true
}

function legalSlotAtoms(
  slot: CompositionBlueprintSlot,
  evidence: ReadonlyMap<string, EvidenceAtom>
) {
  return [...new Set(slot.allowedEvidenceIds)]
    .map(id => evidence.get(id))
    .filter((atom): atom is EvidenceAtom => Boolean(
      atom
      && atom.status !== 'excluded'
      && !atom.riskFlags.includes('sensitive_pii')
      && (slot.scopeId === null || atom.sourceScopeId === slot.scopeId)
      && claimTypesMatchSlot(slot, [atom])
      && canonicalCompositionProofText(proofDisplayText(atom.verbatimText, slot, atom))
    ))
}

function sectionForScopeKind(kind: ResumeEvidenceBundle['timeline'][number]['kind']): CompositionBlueprintSlot['sectionKey'] {
  if (kind === 'experience' || kind === 'internship') return 'experience'
  if (kind === 'project') return 'project'
  if (kind === 'research') return 'research'
  if (kind === 'education') return 'education'
  return 'other'
}

function maximumUniqueCanonicalAssignment(input: {
  slots: CompositionBlueprintSlot[]
  evidence: ReadonlyMap<string, EvidenceAtom>
}) {
  const candidates = input.slots.map(slot => [...new Set(legalSlotAtoms(slot, input.evidence).map(atom => (
    canonicalCompositionProofText(proofDisplayText(atom.verbatimText, slot, atom))
  )))])
  const slotByCanonical = new Map<string, number>()

  const assign = (slotIndex: number, visited: Set<string>): boolean => {
    for (const canonical of candidates[slotIndex]) {
      if (visited.has(canonical)) continue
      visited.add(canonical)
      const previousSlot = slotByCanonical.get(canonical)
      if (previousSlot === undefined || assign(previousSlot, visited)) {
        slotByCanonical.set(canonical, slotIndex)
        return true
      }
    }
    return false
  }

  let assigned = 0
  for (let index = 0; index < input.slots.length; index += 1) {
    if (assign(index, new Set())) assigned += 1
  }
  return assigned
}

/**
 * Zero-provider-call preflight for the server-owned document blueprint.
 * It proves that every planned body fact has a legal destination and that the
 * required slots can receive distinct rendered facts under current validators.
 */
export function validateCompositionBlueprintFeasibility(input: {
  blueprint: CompositionBlueprint
  resume: ResumeEvidenceBundle
  plan: V5ResumePlan
}): ValidationResult<CompositionBlueprint> {
  const issues: ValidationIssue[] = []
  const evidence = new Map(input.resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const plannedEvidenceIds = [...plannedContentEvidenceIds(input.resume, input.plan)]

  if (!sameSet(input.blueprint.requiredBodyEvidenceIds, plannedEvidenceIds)) {
    issues.push(issue({
      code: 'COMPOSITION_BLUEPRINT_PLAN_MISMATCH',
      outputPath: 'blueprint.requiredBodyEvidenceIds',
      message: 'Blueprint 的必用正文证据集合与当前 ResumePlan 不一致。',
      expectedConstraint: 'requiredBodyEvidenceIds 必须等于当前计划正文证据白名单',
      evidenceIds: input.blueprint.requiredBodyEvidenceIds,
    }))
  }

  for (const slotId of duplicates(input.blueprint.slots.map(slot => slot.slotId))) {
    issues.push(issue({
      code: 'COMPOSITION_BLUEPRINT_DUPLICATE_SLOT',
      outputPath: 'blueprint.slots',
      message: `Blueprint slotId 重复：${slotId}`,
      expectedConstraint: '服务端 Blueprint 的每个 slotId 必须唯一',
    }))
  }

  for (const slot of input.blueprint.slots.filter(item => item.required)) {
    if (legalSlotAtoms(slot, evidence).length > 0) continue
    issues.push(issue({
      code: 'COMPOSITION_BLUEPRINT_SLOT_UNFILLABLE',
      outputPath: `blueprint.slots.${slot.slotId}`,
      message: `必填 slot ${slot.slotId} 没有合法、安全且类型匹配的候选证据。`,
      expectedConstraint: '每个 required slot 至少有一个同 scope、非 excluded、非敏感 PII 且 claimType 匹配的 EvidenceAtom',
      evidenceIds: slot.allowedEvidenceIds,
    }))
  }

  for (const evidenceId of input.blueprint.requiredBodyEvidenceIds) {
    const reachable = input.blueprint.slots.some(slot => (
      slot.kind !== 'summary'
      && legalSlotAtoms(slot, evidence).some(atom => atom.evidenceId === evidenceId)
    ))
    if (reachable) continue
    issues.push(issue({
      code: 'COMPOSITION_BLUEPRINT_REQUIRED_EVIDENCE_UNREACHABLE',
      outputPath: 'blueprint.requiredBodyEvidenceIds',
      message: `必用正文证据 ${evidenceId} 没有任何合法的非摘要 slot。`,
      expectedConstraint: '每条 requiredBodyEvidenceId 必须至少进入一个类型及 scope 匹配的非摘要 slot',
      evidenceIds: [evidenceId],
    }))
  }

  const occupiedSections = new Set(input.blueprint.slots.map(slot => slot.sectionKey))
  const timelineByScope = new Map(input.resume.timeline.map(item => [item.scopeId, item]))
  for (const scopePlan of input.plan.scopePlans) {
    if (scopePlan.treatment === 'omit') continue
    const timeline = timelineByScope.get(scopePlan.scopeId)
    if (timeline) occupiedSections.add(sectionForScopeKind(timeline.kind))
  }
  for (const section of occupiedSections) {
    if (input.blueprint.sectionOrder.includes(section)) continue
    issues.push(issue({
      code: 'COMPOSITION_BLUEPRINT_SECTION_UNRENDERABLE',
      outputPath: 'blueprint.sectionOrder',
      message: `已有内容的 ${section} 章节不在 sectionOrder 中，编译时会被静默丢弃。`,
      expectedConstraint: '所有包含 slot 或非 omit 时间线计划的章节必须存在于 sectionOrder',
    }))
  }

  const requiredSlotGroups = new Map<string, CompositionBlueprintSlot[]>()
  for (const slot of input.blueprint.slots.filter(item => item.required)) {
    const key = [slot.sectionKey, slot.scopeId ?? ''].join('\u0000')
    requiredSlotGroups.set(key, [...(requiredSlotGroups.get(key) ?? []), slot])
  }
  for (const slots of requiredSlotGroups.values()) {
    if (slots.length <= 1) continue
    const capacity = maximumUniqueCanonicalAssignment({ slots, evidence })
    if (capacity >= slots.length) continue
    issues.push(issue({
      code: 'COMPOSITION_BLUEPRINT_CANONICAL_CAPACITY_EXCEEDED',
      outputPath: 'blueprint.slots',
      message: `${slots[0].sectionKey}/${slots[0].scopeId ?? 'standalone'} 需要 ${slots.length} 个唯一 slot，但合法证据最多只能形成 ${capacity} 个唯一 canonical 文本。`,
      expectedConstraint: '同章节同 scope 的 required slot 数不得超过可用唯一 canonical 证据数；应降低 bulletBudget 或先修复重复证据',
      evidenceIds: [...new Set(slots.flatMap(slot => slot.allowedEvidenceIds))],
    }))
  }

  const requiredBodyEvidence = new Set(input.blueprint.requiredBodyEvidenceIds)
  for (const summarySlot of input.blueprint.slots.filter(slot => slot.kind === 'summary' && slot.required)) {
    if (
      summarySlot.allowedEvidenceIds.length === 0
      || !summarySlot.allowedEvidenceIds.every(id => requiredBodyEvidence.has(id))
    ) continue
    // TODO: a future plan/schema version should provide summary-only evidence
    // or an explicit reuse policy. Free-text summarization cannot solve this
    // structural overlap without weakening evidence traceability.
    issues.push(issue({
      code: 'COMPOSITION_SUMMARY_BODY_REUSE_REQUIRED',
      severity: 'warning',
      outputPath: `blueprint.slots.${summarySlot.slotId}`,
      message: '摘要 slot 的全部候选证据也都是必用正文证据，当前合约无法避免摘要与正文复用。',
      expectedConstraint: '保守保留事实复用并记录诊断；后续由计划层提供 summary-only evidence 或显式复用策略',
      evidenceIds: summarySlot.allowedEvidenceIds,
    }))
  }

  return {
    passed: !issues.some(item => item.severity === 'error'),
    issues,
    value: input.blueprint,
  }
}

export function validateComposition(input: {
  composition: unknown
  blueprint: CompositionBlueprint
  resume: ResumeEvidenceBundle
  plan: V5ResumePlan
}): ValidationResult<P06CompositionOutput> {
  const issues: ValidationIssue[] = []
  const parsed = p06CompositionOutputSchema.safeParse(input.composition)
  if (!parsed.success) {
    for (const zodIssue of parsed.error.issues.slice(0, 20)) {
      issues.push(issue({
        code: 'COMPOSITION_SCHEMA_INVALID',
        outputPath: zodIssue.path.join('.') || null,
        message: zodIssue.message,
        expectedConstraint: 'Composition 必须严格符合 p06-composition-v1，且不得包含未知字段',
      }))
    }
    return { passed: false, issues }
  }

  const composition = parsed.data
  if (input.blueprint.contractVersion !== P06_COMPOSITION_CONTRACT_VERSION) {
    issues.push(issue({
      code: 'COMPOSITION_BLUEPRINT_VERSION_MISMATCH',
      outputPath: 'blueprint.contractVersion',
      message: `Blueprint 版本 ${input.blueprint.contractVersion} 与当前 Composition 合约不一致。`,
      expectedConstraint: P06_COMPOSITION_CONTRACT_VERSION,
    }))
  }

  issues.push(...validateCompositionBlueprintFeasibility({
    blueprint: input.blueprint,
    resume: input.resume,
    plan: input.plan,
  }).issues)

  const slots = new Map(input.blueprint.slots.map(slot => [slot.slotId, slot]))
  const evidence = new Map(input.resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const companionAssemblyByMembers = new Map(deriveEvidenceAssemblies(input.resume, input.plan)
    .filter(assembly => assembly.kind.startsWith('companion_'))
    .map(assembly => [JSON.stringify(assembly.memberEvidenceIds), assembly]))
  const blocksBySlot = new Map<string, P06CompositionBlock>()
  const duplicateSlotIds = new Set(duplicates(composition.blocks.map(block => block.slotId)))
  for (const duplicate of duplicateSlotIds) {
    issues.push(issue({
      code: 'COMPOSITION_DUPLICATE_SLOT',
      outputPath: 'blocks',
      message: `Composition 重复返回 slot：${duplicate}`,
      expectedConstraint: '每个 Blueprint slot 最多返回一次',
    }))
  }

  for (const [index, block] of composition.blocks.entries()) {
    const path = `blocks[${index}]`
    const slot = slots.get(block.slotId)
    if (!slot) {
      issues.push(issue({
        code: 'COMPOSITION_UNKNOWN_SLOT',
        outputPath: `${path}.slotId`,
        message: `Composition 返回未知 slot：${block.slotId}`,
        expectedConstraint: '模型只能返回服务端 Blueprint 中存在的 slotId',
      }))
      continue
    }
    if (!blocksBySlot.has(block.slotId)) blocksBySlot.set(block.slotId, block)
    const companionAssembly = (slot.kind === 'business_bullet' || slot.kind === 'summary')
      ? companionAssemblyByMembers.get(JSON.stringify(block.evidenceIds))
      : undefined
    const isAllowedCompanionAssembly = Boolean(
      companionAssembly
      && slot.allowedEvidenceIds.includes(companionAssembly.anchorEvidenceId)
    )

    if (/\r|\n/.test(block.text) || /^(?:#{1,6}|[-*+])\s+/.test(block.text.trim()) || /```/.test(block.text)) {
      issues.push(issue({
        code: 'COMPOSITION_TEXT_NOT_SINGLE_LINE',
        outputPath: `${path}.text`,
        message: `slot ${block.slotId} 的 text 包含换行或 Markdown 结构标记。`,
        expectedConstraint: 'text 只能是一条不含 Markdown 标记的候选人事实，结构由服务端生成',
        evidenceIds: block.evidenceIds,
      }))
    }

    const duplicateEvidenceIds = duplicates(block.evidenceIds)
    if (duplicateEvidenceIds.length > 0) {
      issues.push(issue({
        code: 'COMPOSITION_DUPLICATE_EVIDENCE_IN_SLOT',
        outputPath: `${path}.evidenceIds`,
        message: `slot ${block.slotId} 内重复引用证据。`,
        expectedConstraint: '同一 slot 内每条 EvidenceAtom 最多引用一次',
        evidenceIds: duplicateEvidenceIds,
      }))
    }

    const effectiveAllowedEvidenceIds = new Set([
      ...slot.allowedEvidenceIds,
      ...(isAllowedCompanionAssembly ? companionAssembly!.memberEvidenceIds : []),
    ])
    const unallowedEvidenceIds = block.evidenceIds.filter(id => !effectiveAllowedEvidenceIds.has(id))
    if (unallowedEvidenceIds.length > 0) {
      issues.push(issue({
        code: 'COMPOSITION_EVIDENCE_NOT_ALLOWED',
        outputPath: `${path}.evidenceIds`,
        message: `slot ${block.slotId} 引用了 Blueprint 未允许的证据。`,
        expectedConstraint: '每个 block 只能引用对应 slot.allowedEvidenceIds',
        evidenceIds: unallowedEvidenceIds,
      }))
    }

    const atoms = block.evidenceIds
      .map(id => evidence.get(id))
      .filter((atom): atom is EvidenceAtom => Boolean(atom))
    const unknownEvidenceIds = block.evidenceIds.filter(id => !evidence.has(id))
    const unsafeAtoms = atoms.filter(atom => (
      atom.status === 'excluded' || atom.riskFlags.includes('sensitive_pii')
    ))
    if (unknownEvidenceIds.length > 0 || unsafeAtoms.length > 0) {
      issues.push(issue({
        code: 'COMPOSITION_EVIDENCE_UNSAFE',
        outputPath: `${path}.evidenceIds`,
        message: `slot ${block.slotId} 引用了不存在、excluded 或敏感 PII 证据。`,
        expectedConstraint: 'Composition 只能引用存在且可安全展示的 EvidenceAtom',
        evidenceIds: [...unknownEvidenceIds, ...unsafeAtoms.map(atom => atom.evidenceId)],
      }))
    }

    const sourceScopes = new Set(atoms.map(atom => atom.sourceScopeId))
    if (
      sourceScopes.size > 1
      || (slot.scopeId !== null && atoms.some(atom => atom.sourceScopeId !== slot.scopeId))
    ) {
      issues.push(issue({
        code: 'COMPOSITION_CROSS_SCOPE',
        outputPath: `${path}.evidenceIds`,
        message: `slot ${block.slotId} 混入其他 source scope 的证据。`,
        expectedConstraint: '同一 Composition block 的全部证据必须属于同一 sourceScopeId，并匹配 Blueprint scope',
        evidenceIds: block.evidenceIds,
      }))
    }

    if (
      atoms.length === block.evidenceIds.length
      && !isAllowedCompanionAssembly
      && !claimTypesMatchSlot(slot, atoms)
    ) {
      issues.push(issue({
        code: 'COMPOSITION_CLAIM_TYPE_MISMATCH',
        outputPath: `${path}.evidenceIds`,
        message: `slot ${block.slotId} 的证据类型与目标章节不一致。`,
        expectedConstraint: '业务、技能、教育和其他附属章节只能使用对应 claimType',
        evidenceIds: block.evidenceIds,
      }))
    }

    if (
      atoms.length === block.evidenceIds.length
      && unsafeAtoms.length === 0
      && !isSourceProvenCompositionText({ block, slot, atoms })
    ) {
      issues.push(issue({
        code: 'COMPOSITION_TEXT_UNPROVABLE',
        outputPath: `${path}.text`,
        message: `slot ${block.slotId} 的 text 无法由引用证据完整证明。`,
        expectedConstraint: '单证据须完整保留原文；多证据须按 evidenceIds 顺序完整保留并以分号连接',
        evidenceIds: block.evidenceIds,
      }))
    }
  }

  for (const slot of input.blueprint.slots) {
    if (slot.required && !blocksBySlot.has(slot.slotId)) {
      issues.push(issue({
        code: 'COMPOSITION_REQUIRED_SLOT_MISSING',
        outputPath: `slots.${slot.slotId}`,
        message: `Composition 缺少必填 slot：${slot.slotId}`,
        expectedConstraint: '所有 required Blueprint slots 必须恰好返回一次',
        evidenceIds: slot.allowedEvidenceIds,
      }))
    }
  }

  const bodyEvidenceUse = new Map<string, string[]>()
  const renderedTextUse = new Map<string, string[]>()
  for (const slot of input.blueprint.slots) {
    const block = blocksBySlot.get(slot.slotId)
    if (!block) continue
    const atoms = block.evidenceIds.map(id => evidence.get(id)).filter((atom): atom is EvidenceAtom => Boolean(atom))
    if (slot.kind !== 'summary') {
      for (const atom of atoms) {
        if (!BUSINESS_CLAIM_TYPES.has(atom.claimType)) continue
        bodyEvidenceUse.set(atom.evidenceId, [...(bodyEvidenceUse.get(atom.evidenceId) ?? []), slot.slotId])
      }
    }
    const textKey = [slot.sectionKey, slot.scopeId ?? '', canonicalCompositionProofText(block.text)].join('\u0000')
    renderedTextUse.set(textKey, [...(renderedTextUse.get(textKey) ?? []), slot.slotId])
  }

  for (const [evidenceId, slotIds] of bodyEvidenceUse) {
    if (slotIds.length <= 1) continue
    issues.push(issue({
      code: 'COMPOSITION_DUPLICATE_BUSINESS_EVIDENCE',
      outputPath: 'blocks',
      message: `业务证据 ${evidenceId} 被多个正文 slot 重复使用：${slotIds.join('、')}`,
      expectedConstraint: '同一业务 EvidenceAtom 在非摘要正文中最多出现一次',
      evidenceIds: [evidenceId],
    }))
  }

  for (const [textKey, slotIds] of renderedTextUse) {
    if (slotIds.length <= 1 || !textKey.split('\u0000').at(-1)) continue
    issues.push(issue({
      code: 'COMPOSITION_DUPLICATE_RENDERED_TEXT',
      outputPath: 'blocks',
      message: `同一章节和 scope 中存在无法唯一映射的重复正文：${slotIds.join('、')}`,
      expectedConstraint: '编译后的每条 claim 文本必须能在其章节和 scope 内唯一定位',
    }))
  }

  const usedBodyEvidenceIds = new Set([...blocksBySlot]
    .filter(([slotId]) => slots.get(slotId)?.kind !== 'summary')
    .flatMap(([, block]) => block.evidenceIds))
  const missingBodyEvidenceIds = input.blueprint.requiredBodyEvidenceIds.filter(id => !usedBodyEvidenceIds.has(id))
  if (missingBodyEvidenceIds.length > 0) {
    issues.push(issue({
      code: 'COMPOSITION_REQUIRED_EVIDENCE_MISSING',
      outputPath: 'blocks',
      message: `Composition 遗漏 ${missingBodyEvidenceIds.length} 条计划正文证据。`,
      expectedConstraint: '所有 requiredBodyEvidenceIds 必须在非摘要正文中至少使用一次',
      evidenceIds: missingBodyEvidenceIds,
    }))
  }

  const orderedBlocks = input.blueprint.slots
    .map(slot => blocksBySlot.get(slot.slotId))
    .filter((block): block is P06CompositionBlock => Boolean(block))
    .map(block => ({ ...block, text: block.text.trim(), evidenceIds: [...block.evidenceIds] }))
  const value: P06CompositionOutput = {
    contractVersion: P06_COMPOSITION_CONTRACT_VERSION,
    blocks: orderedBlocks,
  }
  return { passed: !issues.some(item => item.severity === 'error'), issues, value }
}
