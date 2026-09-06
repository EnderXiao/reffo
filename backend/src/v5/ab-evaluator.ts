import type { LlmProvider } from '@/providers/llm-provider'
import { runV5StructuredStage, type V5StageOutputAudit } from '@/v5/stage-runner'
import type {
  BlindABEvaluation,
  GeneratedResumeArtifact,
  JobRequirementBundle,
  ResumeEvidenceBundle,
  V5StageEnvelope,
} from '@/v5/types'
import { V5_SCHEMA_VERSION, V5_WORKFLOW_VERSION } from '@/v5/types'
import { validateJudgeCitations } from '@/v5/judge-citations'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'

export interface DoubleOrderAbInput {
  runId: string
  resumeEvidenceBundle: ResumeEvidenceBundle
  jobRequirementBundle: JobRequirementBundle
  originalJobDescription?: string
  candidateLeft: GeneratedResumeArtifact
  candidateRight: GeneratedResumeArtifact
}

export interface DoubleOrderAbResult {
  forward: BlindABEvaluation
  reverse: BlindABEvaluation
  normalizedForwardWinner: 'left' | 'right' | 'tie'
  normalizedReverseWinner: 'left' | 'right' | 'tie'
  orderConsistent: boolean
  absoluteGateConsistent: boolean
  scoreDriftMax: number
  outputAudits: {
    forward: V5StageOutputAudit
    reverse: V5StageOutputAudit
  }
}

function replaceLiteral(value: string, target: string | null, replacement: string) {
  const normalized = target?.trim()
  if (!normalized || normalized.length < 2) return value
  return value.split(normalized).join(replacement)
}

function redactResumeIdentityText(value: string, resume: ResumeEvidenceBundle) {
  let redacted = replaceLiteral(value, resume.identity.name.value, '[姓名已隐藏]')
  redacted = replaceLiteral(redacted, resume.identity.email.value, '[邮箱已隐藏]')
  redacted = replaceLiteral(redacted, resume.identity.phone.value, '[电话已隐藏]')
  for (const link of resume.identity.links) {
    redacted = replaceLiteral(redacted, link.url, '[链接已隐藏]')
  }
  redacted = redacted
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[邮箱已隐藏]')
    .replace(/(?:https?:\/\/|www\.)[^\s<>()]+/giu, '[链接已隐藏]')
    .replace(/(^|[^\d])((?:\+?86[\s-]*)?1[3-9]\d(?:[\s-]*\d){8})(?!\d)/gu, '$1[电话已隐藏]')
  return redacted
}

function redactNullableResumeIdentityText(value: string | null, resume: ResumeEvidenceBundle) {
  return value === null ? null : redactResumeIdentityText(value, resume)
}

function compactResumeEvidence(resume: ResumeEvidenceBundle, candidateTexts: string[]) {
  const redactedIdentityEvidenceIds = new Set([
    ...resume.identity.name.evidenceIds,
    ...resume.identity.email.evidenceIds,
    ...resume.identity.phone.evidenceIds,
    ...resume.identity.links.flatMap(item => item.evidenceIds),
  ])
  const cityEvidenceIds = new Set(resume.identity.cityLevelLocation.evidenceIds)
  const eligibleEvidence = resume.evidenceAtoms.filter(atom => (
    atom.status !== 'excluded'
    && !redactedIdentityEvidenceIds.has(atom.evidenceId)
    && (!atom.riskFlags.includes('sensitive_pii') || cityEvidenceIds.has(atom.evidenceId))
  ))
  const eligibleEvidenceIds = new Set(eligibleEvidence.map(atom => atom.evidenceId))
  const filterEvidenceIds = (ids: string[]) => ids.filter(id => eligibleEvidenceIds.has(id))
  const eligibleEvidenceById = new Map(eligibleEvidence.map(atom => [atom.evidenceId, atom]))
  const numbers = (text: string) => text.normalize('NFKC').match(/\d+(?:[.,]\d+)*/gu) ?? []
  const coveredNumbers = new Set(eligibleEvidence.flatMap(atom => numbers(atom.verbatimText)))
  const missingNumbers = new Set(candidateTexts.flatMap(numbers).filter(number => !coveredNumbers.has(number)))
  // Excluded facts are audit context only. Their presence cannot authorize using them in a resume.
  let auditCharacters = 0
  let auditOmittedCount = 0
  const auditOnlyExcludedEvidence = resume.evidenceAtoms.flatMap(atom => {
    if (atom.status !== 'excluded' || atom.claimType === 'identity' || redactedIdentityEvidenceIds.has(atom.evidenceId)
      || atom.riskFlags.some(flag => ['sensitive_pii', 'prompt_injection_like_text'].includes(flag))
      || !numbers(atom.verbatimText).some(number => missingNumbers.has(number))) return []
    const verbatimText = redactResumeIdentityText(atom.verbatimText, resume)
    if (auditCharacters + verbatimText.length > 8_000) { auditOmittedCount += 1; return [] }
    auditCharacters += verbatimText.length
    return [{ evidenceId: atom.evidenceId, sourceScopeId: atom.sourceScopeId, sourceBlockId: atom.sourceBlockId,
      verbatimText, status: atom.status, riskFlags: atom.riskFlags, usableForGeneration: false }]
  })
  return {
    schemaVersion: resume.schemaVersion,
    sourceDocument: { primaryLanguage: resume.sourceDocument.primaryLanguage },
    identity: {
      name: { value: null, evidenceIds: [] },
      email: { value: null, evidenceIds: [] },
      phone: { value: null, evidenceIds: [] },
      cityLevelLocation: {
        value: redactNullableResumeIdentityText(resume.identity.cityLevelLocation.value, resume),
        evidenceIds: filterEvidenceIds(resume.identity.cityLevelLocation.evidenceIds),
      },
      links: [],
    },
    timeline: resume.timeline
      .filter(item => item.evidenceIds.some(id => eligibleEvidenceById.get(id)?.claimType === 'timeline'))
      .map(item => ({
        scopeId: item.scopeId,
        kind: item.kind,
        organization: redactNullableResumeIdentityText(item.organization, resume),
        title: redactNullableResumeIdentityText(item.title, resume),
        start: redactNullableResumeIdentityText(item.start, resume),
        end: redactNullableResumeIdentityText(item.end, resume),
        evidenceIds: filterEvidenceIds(item.evidenceIds),
      })),
    evidenceAtoms: eligibleEvidence.map(atom => ({
      evidenceId: atom.evidenceId,
      sourceScopeId: atom.sourceScopeId,
      verbatimText: redactResumeIdentityText(atom.verbatimText, resume),
      normalizedClaim: redactResumeIdentityText(atom.normalizedClaim, resume),
      claimType: atom.claimType,
      status: atom.status,
      attributionLevel: atom.attributionLevel,
      sourceActionVerb: redactNullableResumeIdentityText(atom.sourceActionVerb, resume),
      qualifiers: atom.qualifiers.map(value => redactResumeIdentityText(value, resume)),
      numericAtoms: atom.numericAtoms.map(numeric => ({
        ...numeric,
        raw: redactResumeIdentityText(numeric.raw, resume),
        valueText: redactResumeIdentityText(numeric.valueText, resume),
        unit: redactNullableResumeIdentityText(numeric.unit, resume),
        qualifier: redactNullableResumeIdentityText(numeric.qualifier, resume),
        period: redactNullableResumeIdentityText(numeric.period, resume),
      })),
      riskFlags: atom.riskFlags,
    })),
    conflicts: resume.conflicts
      .filter(item => (
        item.evidenceIds.length > 0
        && item.evidenceIds.every(id => eligibleEvidenceIds.has(id))
      ))
      .map(item => ({
        ...item,
        description: redactResumeIdentityText(item.description, resume),
      })),
    extractionCoverage: {
      coverageRatio: resume.extractionCoverage.coverageRatio,
      highImportanceUnmappedCount: resume.extractionCoverage.highImportanceUnmappedCount,
    },
    auditOnlyExcludedEvidence,
    auditSourceLimitations: { isCompleteSource: false, auditOmittedCount,
      instruction: '排除证据仅用于辨别数字是否在原文出现，不证明事实可用；本视图仍可能缺少来源，无法核验不等于证实新增。' },
  }
}

function compactJobRequirements(job: JobRequirementBundle) {
  return {
    schemaVersion: job.schemaVersion,
    basicInfo: job.basicInfo,
    requirementAtoms: job.requirementAtoms.map(atom => ({
      requirementId: atom.requirementId,
      verbatimText: atom.verbatimText,
      normalizedRequirement: atom.normalizedRequirement,
      category: atom.category,
      importance: atom.importance,
      logicGroupId: atom.logicGroupId,
      logicOperator: atom.logicOperator,
      explicitness: atom.explicitness,
    })),
    explicitCompanySignals: job.explicitCompanySignals,
    explicitLocationSignals: job.explicitLocationSignals,
    uncertainties: job.uncertainties,
    sourcedContext: job.sourcedContext,
    extractionCoverage: job.extractionCoverage,
  }
}

interface BlindAbPayload {
  resumeEvidenceBundle: ReturnType<typeof compactResumeEvidence>
  jobRequirementBundle: ReturnType<typeof compactJobRequirements>
  originalJob: { available: boolean; blocks: Array<{ sourceBlockId: string; text: string; inputRiskFlags: string[] }> }
  candidates: Array<{ candidateId: 'A' | 'B'; markdown: string }>
}

function envelope(
  input: DoubleOrderAbInput,
  first: GeneratedResumeArtifact,
  second: GeneratedResumeArtifact
): V5StageEnvelope<BlindAbPayload> {
  return {
    schemaVersion: V5_SCHEMA_VERSION,
    runId: input.runId,
    workflowVersion: V5_WORKFLOW_VERSION,
    payload: {
      // P12 needs the auditable facts, timeline and requirements—not the
      // extraction bookkeeping that repeats the same material. Keeping this
      // projection local to the offline evaluator halves large-case inputs
      // without changing the judge prompt or its output schema.
      resumeEvidenceBundle: compactResumeEvidence(input.resumeEvidenceBundle, [first, second].map(candidate => redactResumeIdentityText(candidate.markdown, input.resumeEvidenceBundle))),
      jobRequirementBundle: compactJobRequirements(input.jobRequirementBundle),
      originalJob: {
        available: Boolean(input.originalJobDescription?.trim()),
        blocks: input.originalJobDescription?.trim()
          ? canonicalizeSourceDocument(input.originalJobDescription, 'jd:offline-audit').canonicalDocument.blocks
            .map(({ sourceBlockId, text, inputRiskFlags }) => ({ sourceBlockId, inputRiskFlags, text: redactResumeIdentityText(text, input.resumeEvidenceBundle) })) : [],
      },
      candidates: [
        { candidateId: 'A', markdown: redactResumeIdentityText(first.markdown, input.resumeEvidenceBundle) },
        { candidateId: 'B', markdown: redactResumeIdentityText(second.markdown, input.resumeEvidenceBundle) },
      ],
    },
  }
}

function normalizedWinner(result: BlindABEvaluation, reversed: boolean) {
  if (result.pairwise.winner === 'tie') return 'tie' as const
  const firstWon = result.pairwise.winner === 'A'
  if (reversed) return firstWon ? 'right' as const : 'left' as const
  return firstWon ? 'left' as const : 'right' as const
}

function scoreTotal(result: BlindABEvaluation, candidateId: 'A' | 'B') {
  const item = result.evaluations.find(candidate => candidate.candidateId === candidateId)
  return item ? Object.values(item.dimensions).reduce((sum, score) => sum + score, 0) : 0
}

export async function runDoubleOrderBlindAb(
  input: DoubleOrderAbInput,
  options: { provider?: LlmProvider; maxAcceptedScoreDrift?: number } = {}
): Promise<DoubleOrderAbResult> {
  // Keep the two order checks sequential. Besides avoiding overlapping budget
  // reservations for two large prompts, this prevents the reverse-order call
  // from consuming tokens when the forward-order call has already failed.
  const forwardEnvelope = envelope(input, input.candidateLeft, input.candidateRight)
  const reverseEnvelope = envelope(input, input.candidateRight, input.candidateLeft)
  const forwardStage = await runV5StructuredStage<BlindABEvaluation>({
    component: 'P12',
    envelope: forwardEnvelope,
    options: { provider: options.provider },
  })
  validateJudgeCitations(forwardStage.value, forwardEnvelope.payload.candidates)
  const reverseStage = await runV5StructuredStage<BlindABEvaluation>({
    component: 'P12',
    envelope: reverseEnvelope,
    options: { provider: options.provider },
  })
  validateJudgeCitations(reverseStage.value, reverseEnvelope.payload.candidates)
  const forward = forwardStage.value
  const reverse = reverseStage.value

  const normalizedForwardWinner = normalizedWinner(forward, false)
  const normalizedReverseWinner = normalizedWinner(reverse, true)
  const forwardGates = {
    left: forward.evaluations.find(item => item.candidateId === 'A')?.absoluteGate,
    right: forward.evaluations.find(item => item.candidateId === 'B')?.absoluteGate,
  }
  const reverseGates = {
    left: reverse.evaluations.find(item => item.candidateId === 'B')?.absoluteGate,
    right: reverse.evaluations.find(item => item.candidateId === 'A')?.absoluteGate,
  }
  const scoreDriftMax = Math.max(
    Math.abs(scoreTotal(forward, 'A') - scoreTotal(reverse, 'B')),
    Math.abs(scoreTotal(forward, 'B') - scoreTotal(reverse, 'A'))
  )
  const absoluteGateConsistent = forwardGates.left === reverseGates.left && forwardGates.right === reverseGates.right
  const orderConsistent = normalizedForwardWinner === normalizedReverseWinner
    && absoluteGateConsistent
    && scoreDriftMax <= (options.maxAcceptedScoreDrift ?? 8)

  return {
    forward,
    reverse,
    normalizedForwardWinner,
    normalizedReverseWinner,
    orderConsistent,
    absoluteGateConsistent,
    scoreDriftMax,
    outputAudits: {
      forward: forwardStage.outputAudit,
      reverse: reverseStage.outputAudit,
    },
  }
}
