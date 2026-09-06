import type {
  EvidenceAtom,
  GeneratedResumeArtifact,
  GenerationPolicy,
  ResumeEvidenceBundle,
  ValidationIssue,
  V5ResumePlan,
} from '@/v5/types'
import { V5_SCHEMA_VERSION } from '@/v5/types'
import { measureArtifactMarkdown, plannedContentEvidenceIds } from '@/v5/validators'
import { compositionSectionForScopeKind } from '@/v5/composition/blueprint'
import {
  P06_COMPOSITION_COMPILER_VERSION,
  P06_COMPOSITION_CONTRACT_VERSION,
  type CompositionBlueprint,
  type CompositionCompileResult,
  type CompositionSectionKey,
  type CompositionBlueprintSlot,
  type P06CompositionOutput,
} from '@/v5/composition/contract'
import {
  canonicalCompositionProofText,
  normalizeCompositionDisplayText,
  validateComposition,
} from '@/v5/composition/validator'

const SECTION_TITLES: Record<CompositionSectionKey, [english: string, chinese: string]> = {
  summary: ['Professional Summary', '职业摘要'],
  experience: ['Work Experience', '工作经历'],
  project: ['Projects', '项目经历'],
  research: ['Research', '研究经历'],
  education: ['Education', '教育背景'],
  skills: ['Skills', '专业技能'],
  portfolio: ['Portfolio', '作品集'],
  certifications: ['Certifications', '证书'],
  languages: ['Languages', '语言能力'],
  publications: ['Publications', '论文发表'],
  patents: ['Patents', '专利'],
  awards: ['Awards', '荣誉奖项'],
  other: ['Other Experience', '其他经历'],
}

function isEnglishOutput(language: string) {
  return /^(?:en|english)(?:[-_]|$)/i.test(language.trim())
}

function sectionTitle(section: CompositionSectionKey, language: string) {
  return SECTION_TITLES[section][isEnglishOutput(language) ? 0 : 1]
}

function timelineText(item: ResumeEvidenceBundle['timeline'][number]) {
  return [
    item.organization,
    item.title,
    [item.start, item.end].filter(Boolean).join(' - '),
  ].filter(Boolean).join('｜')
}

function timelineStart(value: string | null) {
  const parts = value?.match(/((?:19|20)\d{2})(?:\s*[.年/\-]\s*(\d{1,2}))?/u)
  return parts ? Number(parts[1]) * 12 + Number(parts[2] ?? 0) : 0
}

function withoutMarkdownMarker(value: string) {
  return normalizeCompositionDisplayText(value)
}

function weakestAttribution(atoms: EvidenceAtom[]) {
  const rank = { unspecified: 0, supported: 1, contributed: 2, drove: 3, owned: 4 } as const
  return [...atoms].sort((left, right) => rank[left.attributionLevel] - rank[right.attributionLevel])[0]
    ?.attributionLevel ?? 'unspecified'
}

function normalizedClaimText(value: string, outputPath: string, atom: EvidenceAtom) {
  let normalized = withoutMarkdownMarker(value)
  if (/^identity\.name$/i.test(outputPath)) normalized = normalized.replace(/^#{1,6}\s+/, '').trim()
  if (atom.claimType === 'skill' && /^skills?(?:\.|\[|$)/i.test(outputPath)) {
    normalized = normalized.replace(/^(?:专业技能|技能|skills?)\s*[:：]\s*/i, '').trim()
  }
  return canonicalCompositionProofText(normalized)
}

function transformationFor(input: {
  outputPath: string
  outputText: string
  atoms: EvidenceAtom[]
  slot?: CompositionBlueprintSlot
}): GeneratedResumeArtifact['claims'][number]['transformation'] {
  if (/^timeline(?:\.|\[|$)/i.test(input.outputPath)) return 'safe_paraphrase'
  if (input.slot?.kind === 'summary') {
    return input.atoms.length > 1 && new Set(input.atoms.map(atom => atom.sourceScopeId)).size === 1
      ? 'same_scope_merge' : 'safe_paraphrase'
  }
  if (
    input.atoms.length === 1
    && normalizedClaimText(input.outputText, input.outputPath, input.atoms[0])
      === normalizedClaimText(input.atoms[0].verbatimText, input.outputPath, input.atoms[0])
  ) return 'verbatim'
  return input.atoms.length > 1 ? 'same_scope_merge' : 'safe_paraphrase'
}

export class CompositionCompileError extends Error {
  readonly code = 'P06_COMPOSITION_VALIDATION_FAILED' as const

  constructor(readonly issues: ValidationIssue[]) {
    super('P06 Composition 未通过服务端确定性校验，拒绝编译 Artifact。')
    this.name = 'CompositionCompileError'
  }
}

type PendingClaim = {
  outputPath: string
  outputText: string
  atoms: EvidenceAtom[]
  slot?: CompositionBlueprintSlot
}

type SectionItem =
  | { kind: 'heading'; text: string }
  | { kind: 'claim'; claim: PendingClaim }

export function compileCompositionArtifact(input: {
  composition: unknown
  blueprint: CompositionBlueprint
  resume: ResumeEvidenceBundle
  plan: V5ResumePlan
  policy: GenerationPolicy
}): CompositionCompileResult {
  const validation = validateComposition({
    composition: input.composition,
    blueprint: input.blueprint,
    resume: input.resume,
    plan: input.plan,
  })
  if (!validation.passed || !validation.value) throw new CompositionCompileError(validation.issues)

  return renderValidatedCompositionArtifact({ ...input, composition: validation.value })
}

/** Internal renderer. Callers must first validate their versioned writing contract. */
export function renderValidatedCompositionArtifact(input: {
  composition: P06CompositionOutput
  blueprint: CompositionBlueprint
  resume: ResumeEvidenceBundle
  plan: V5ResumePlan
  policy: GenerationPolicy
}): CompositionCompileResult {
  const composition = input.composition
  const blockBySlot = new Map(composition.blocks.map(block => [block.slotId, block]))
  const evidence = new Map(input.resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const scopePlanById = new Map(input.plan.scopePlans.map(item => [item.scopeId, item]))
  const slotsBySection = new Map<CompositionSectionKey, CompositionBlueprint['slots']>()
  for (const slot of [...input.blueprint.slots].sort((left, right) => left.order - right.order)) {
    slotsBySection.set(slot.sectionKey, [...(slotsBySection.get(slot.sectionKey) ?? []), slot])
  }

  const claims: GeneratedResumeArtifact['claims'] = []
  const lines: string[] = []
  let claimIndex = 0

  const atomsFor = (ids: string[]) => ids
    .map(id => evidence.get(id))
    .filter((atom): atom is EvidenceAtom => Boolean(
      atom
      && atom.status !== 'excluded'
      && !atom.riskFlags.includes('sensitive_pii')
    ))

  // Fixed identity values are server-verified projections rather than
  // model-selected body content. A single source atom may legitimately prove
  // multiple fields on one contact line, but non-identity and excluded atoms
  // never receive this sensitive-PII exception.
  const fixedIdentityAtomsFor = (ids: string[]) => ids
    .map(id => evidence.get(id))
    .filter((atom): atom is EvidenceAtom => Boolean(
      atom
      && atom.claimType === 'identity'
      && atom.status !== 'excluded'
    ))

  const appendClaim = (claim: PendingClaim) => {
    if (!claim.outputText.trim() || claim.atoms.length === 0) return
    claimIndex += 1
    lines.push(claim.outputText)
    claims.push({
      claimId: `composition_claim_${String(claimIndex).padStart(4, '0')}`,
      outputPath: claim.outputPath,
      outputText: claim.outputText,
      evidenceIds: [...new Set(claim.atoms.map(atom => atom.evidenceId))],
      transformation: transformationFor(claim),
      attributionLevel: weakestAttribution(claim.atoms),
    })
  }

  if (input.resume.identity.name.value) {
    const atoms = fixedIdentityAtomsFor(input.resume.identity.name.evidenceIds)
    if (atoms.length > 0) {
      appendClaim({ outputPath: 'identity.name', outputText: `# ${input.resume.identity.name.value}`, atoms })
    } else lines.push(`# ${input.resume.identity.name.value}`)
  } else lines.push('# Resume')
  lines.push('')

  const identityFields = [
    ['email', input.resume.identity.email],
    ['phone', input.resume.identity.phone],
    ['location', input.resume.identity.cityLevelLocation],
  ] as const
  for (const [field, identity] of identityFields) {
    if (!identity.value) continue
    // Contact fields are intentionally classified as sensitive PII in the
    // general evidence catalog. They are safe here only because the value and
    // evidence IDs come from the server-verified identity projection, never
    // from a model-selected Composition block.
    const atoms = fixedIdentityAtomsFor(identity.evidenceIds)
    if (atoms.length === 0) continue
    appendClaim({ outputPath: `identity.${field}`, outputText: identity.value, atoms })
  }
  for (const [index, link] of input.resume.identity.links.entries()) {
    const atoms = fixedIdentityAtomsFor(link.evidenceIds)
    if (atoms.length === 0) continue
    appendClaim({ outputPath: `identity.links[${index}]`, outputText: link.url, atoms })
  }

  const renderSection = (section: CompositionSectionKey, items: SectionItem[]) => {
    if (items.length === 0) return
    lines.push(`## ${sectionTitle(section, input.blueprint.outputLanguage)}`, '')
    for (const item of items) {
      if (item.kind === 'heading') lines.push(item.text, '')
      else appendClaim(item.claim)
    }
    lines.push('')
  }

  for (const section of input.blueprint.sectionOrder) {
    if (section === 'summary') {
      const summarySlot = (slotsBySection.get(section) ?? [])[0]
      const block = summarySlot ? blockBySlot.get(summarySlot.slotId) : undefined
      if (!summarySlot || !block) continue
      const atoms = atomsFor(block.evidenceIds)
      const prefix = isEnglishOutput(input.blueprint.outputLanguage)
        ? 'Professional summary: '
        : '职业概述：'
      renderSection(section, [{
        kind: 'claim',
        claim: {
          outputPath: summarySlot.outputPath,
          outputText: `${prefix}${withoutMarkdownMarker(block.text)}`,
          atoms,
          slot: summarySlot,
        },
      }])
      continue
    }

    if (['experience', 'project', 'research', 'education', 'other'].includes(section)) {
      const items: SectionItem[] = []
      const orderedTimeline = [...input.resume.timeline].sort((left, right) => section === 'experience'
        ? timelineStart(right.start) - timelineStart(left.start) : 0)
      for (const timeline of orderedTimeline) {
        if (compositionSectionForScopeKind(timeline.kind) !== section) continue
        const scopePlan = scopePlanById.get(timeline.scopeId)
        if (!scopePlan || scopePlan.treatment === 'omit') continue
        if (scopePlan.treatment === 'timeline_line') {
          const atoms = atomsFor(timeline.evidenceIds).filter(atom => atom.claimType === 'timeline')
          const text = timelineText(timeline)
          if (text && atoms.length > 0) {
            items.push({
              kind: 'claim',
              claim: { outputPath: `timeline.${timeline.scopeId}`, outputText: text, atoms },
            })
          }
          continue
        }
        const scopeSlots = (slotsBySection.get(section) ?? [])
          .filter(slot => slot.scopeId === timeline.scopeId)
          .sort((left, right) => left.order - right.order)
        if (scopeSlots.length === 0) continue
        const heading = timelineText(timeline)
        if (!heading) continue
        items.push({ kind: 'heading', text: `### ${heading}` })
        for (const slot of scopeSlots) {
          const block = blockBySlot.get(slot.slotId)
          if (!block) continue
          items.push({
            kind: 'claim',
            claim: {
              outputPath: slot.outputPath,
              outputText: `- ${withoutMarkdownMarker(block.text)}`,
              atoms: atomsFor(block.evidenceIds),
              slot,
            },
          })
        }
      }
      renderSection(section, items)
      continue
    }

    const items: SectionItem[] = []
    for (const slot of (slotsBySection.get(section) ?? []).sort((left, right) => left.order - right.order)) {
      const block = blockBySlot.get(slot.slotId)
      if (!block) continue
      items.push({
        kind: 'claim',
        claim: {
          outputPath: slot.outputPath,
          outputText: `- ${withoutMarkdownMarker(block.text)}`,
          atoms: atomsFor(block.evidenceIds),
          slot,
        },
      })
    }
    renderSection(section, items)
  }

  const markdown = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const usedEvidenceIds = [...new Set(claims.flatMap(claim => claim.evidenceIds))]
  const plannedEvidenceIds = [...plannedContentEvidenceIds(input.resume, input.plan)]
  return {
    artifact: {
      schemaVersion: V5_SCHEMA_VERSION,
      markdown,
      claims,
      usedEvidenceIds,
      omittedPlannedEvidenceIds: plannedEvidenceIds.filter(id => !usedEvidenceIds.includes(id)),
      renderStats: measureArtifactMarkdown(markdown),
    },
    diagnostics: {
      contractVersion: P06_COMPOSITION_CONTRACT_VERSION,
      compilerVersion: P06_COMPOSITION_COMPILER_VERSION,
      degradedSlotIds: [],
    },
  }
}
