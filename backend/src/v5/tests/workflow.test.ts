import { describe, expect, test } from 'bun:test'
import { createHarnessEventBus } from '@/harness/event-bus'
import type { HarnessEvent } from '@/harness/events'
import type { ChatCompletionInput, ChatCompletionResult, LlmProvider } from '@/providers/llm-provider'
import { buildAdaptiveStrategy } from '@/v5/adaptive-policy'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import {
  resumeExtractionMaxRepairBudget,
  ResumeExtractionChunkPlanError,
  splitResumeDocument,
} from '@/v5/chunked-resume-extraction'
import {
  P06_COMPOSITION_CONTRACT_VERSION,
  type CompositionBlueprint,
  type P06CompositionOutput,
} from '@/v5/composition/contract'
import {
  P06_DSL_CONTRACT_VERSION,
  type P06DslOutput,
} from '@/v5/composition/dsl'
import { renderSourcePreservingArtifact } from '@/v5/safe-renderer'
import { validateResumeExtractionCandidate } from '@/v5/evidence'
import { createTrustedResumeExtractionCache } from '@/v5/resume-extraction-cache'
import { createJobFixture, createMatchFixture, createResumeFixture, FIXTURE_JD, FIXTURE_RESUME } from '@/v5/tests/fixtures'
import { createTargetingFixture } from '@/v5/tests/targeting-fixtures'
import type { JobTarget } from '@/v5/targeting/profile'
import type { JobFitMap } from '@/v5/targeting/contracts'
import type {
  CanonicalSourceDocument,
  EvidenceAtom,
  GeneratedResumeArtifact,
  GenerationPolicy,
  JobExtractionCandidate,
  ResumeExtractionCandidate,
  ResumeEvidenceBundle,
  ResumeStrategyProfile,
  V5MatchAnalysis,
  V5ResumeExtractionResult,
  V5ResumePlan,
} from '@/v5/types'
import { V5_SCHEMA_VERSION } from '@/v5/types'
import {
  buildCompactMatchingJobContext,
  buildCompactMatchingResumeContext,
  buildModelSafeResumeEvidenceBundle,
  calculateResumeExtractionTimeoutMs,
  hasV5BlockingStructureIssue,
  shouldAttemptV5ArtifactRepair,
  V5ResumeOptimizationWorkflow,
  V5WorkflowBlockedError,
} from '@/v5/main/workflow'

interface TestEnvelopePayload {
  jobTargetingPolicy?: string
  targets?: JobTarget[]
  resumeContext?: { facts: Array<{ evidenceId: string; claimType: string; text: string }> }
  jobTargeting?: { tasks: Array<{ id: string }> }
  writingPolicy?: string
  skillPolicy?: string
  facts?: Array<{ evidenceId: string; text: string }>
  extractionSequence?: { index: number; total: number }
  repairMode?: 'schema_only' | 'artifact_structural'
  repairAttempt?: number
  strategyProfile?: ResumeStrategyProfile
  generationPolicy?: GenerationPolicy
  resumePlan?: V5ResumePlan
  currentOutput?: V5ResumePlan
  draftArtifact?: GeneratedResumeArtifact
  artifact?: GeneratedResumeArtifact
  previousArtifact?: unknown
  validationIssues?: unknown[]
  evidenceAtoms?: EvidenceAtom[]
  blueprint?: Omit<CompositionBlueprint, 'slots'> & { slots: Array<CompositionBlueprint['slots'][number] & { facts?: Array<{ evidenceId: string; text: string }> }> }
  requirementAtoms?: Array<{ requirementId: string }>
  canonicalJobDocument?: CanonicalSourceDocument
  canonicalSourceDocument?: CanonicalSourceDocument
  originalEnvelope?: { payload?: TestEnvelopePayload }
  resumeEvidenceBundle?: {
    evidenceAtoms: Array<Pick<EvidenceAtom, 'evidenceId' | 'claimType' | 'status'>>
  }
  jobRequirementBundle?: {
    requirementAtoms: Array<{
      requirementId: string
      importance: 'must_have' | 'core_outcome' | 'differentiator' | 'nice_to_have'
    }>
  }
  identityAndTimeline?: {
    identity: ResumeEvidenceBundle['identity']
    timeline: ResumeEvidenceBundle['timeline']
  }
}

function parseEnvelope(input: ChatCompletionInput) {
  const content = input.messages.find(message => message.role === 'user')?.content ?? ''
  const match = content.match(/UNTRUSTED_INPUT_JSON:\n([\s\S]+?)\n\n只返回本阶段/)
  if (!match) throw new Error('missing test envelope')
  return JSON.parse(match[1]) as { payload: TestEnvelopePayload }
}

function createMatchFromEnvelope(payload: TestEnvelopePayload): V5MatchAnalysis {
  const evidenceAtoms = payload.resumeEvidenceBundle?.evidenceAtoms
  const requirementAtoms = payload.jobRequirementBundle?.requirementAtoms
  if (!evidenceAtoms || !requirementAtoms) throw new Error('P03 fixture needs compact resume and JD contexts')

  const usableEvidence = evidenceAtoms.filter(atom => atom.status !== 'excluded')
  const businessEvidence = usableEvidence.find(atom => (
    ['responsibility', 'action', 'deliverable', 'result'].includes(atom.claimType)
  ))
  const skillEvidence = usableEvidence.find(atom => atom.claimType === 'skill')
  const requirementMatches: V5MatchAnalysis['requirementMatches'] = requirementAtoms.map(requirement => {
    const evidence = requirement.importance === 'must_have'
      ? skillEvidence ?? businessEvidence
      : businessEvidence ?? skillEvidence
    return {
      requirementId: requirement.requirementId,
      status: evidence
        ? requirement.importance === 'must_have' && evidence.claimType === 'skill'
          ? 'direct_match' as const
          : 'transferable_match' as const
        : 'currently_unproven' as const,
      evidenceIds: evidence ? [evidence.evidenceId] : [],
      confidence: evidence?.claimType === 'skill' ? 'high' as const : evidence ? 'medium' as const : 'low' as const,
      rationale: evidence ? '测试桩按当前 envelope 的真实 ID 建立匹配' : '当前 envelope 没有可用匹配证据',
    }
  })
  const matched = requirementMatches.filter(match => match.evidenceIds.length > 0)
  const primaryEvidenceIds = [...new Set(matched.flatMap(match => match.evidenceIds))]
  const must = requirementMatches.filter((match, index) => requirementAtoms[index]?.importance === 'must_have')
  const core = requirementMatches.filter((match, index) => requirementAtoms[index]?.importance === 'core_outcome')

  return {
    schemaVersion: V5_SCHEMA_VERSION,
    requirementMatches,
    strengths: matched.map((match, index) => ({
      strengthId: `st${index + 1}`,
      requirementIds: [match.requirementId],
      evidenceIds: match.evidenceIds,
      statement: '当前输入中存在可用匹配证据',
    })),
    gaps: [],
    positioning: {
      statement: '以当前简历证据回应岗位要求。',
      primaryRequirementIds: requirementAtoms.map(atom => atom.requirementId),
      primaryEvidenceIds,
      forbiddenIdentityClaims: ['高级产品经理'],
    },
    scoreInputs: {
      mustHaveApplicable: must.length,
      mustHaveDirect: must.filter(match => match.status === 'direct_match').length,
      mustHaveTransferable: must.filter(match => match.status === 'transferable_match').length,
      coreOutcomeApplicable: core.length,
      coreOutcomeDirect: core.filter(match => match.status === 'direct_match').length,
      coreOutcomeTransferable: core.filter(match => match.status === 'transferable_match').length,
      evidenceClarityRatio: evidenceAtoms.length === 0
        ? 0
        : evidenceAtoms.filter(atom => atom.status === 'source_supported').length / evidenceAtoms.length,
    },
    contextUsed: [],
  }
}

function createArtifactFromEnvelope(payload: TestEnvelopePayload) {
  if (!payload.resumePlan || !payload.identityAndTimeline || !payload.evidenceAtoms) {
    throw new Error('artifact fixture needs the current plan, identity/timeline and evidence catalog')
  }
  const resume = structuredClone(createResumeFixture().bundle)
  resume.identity = payload.identityAndTimeline.identity
  resume.timeline = payload.identityAndTimeline.timeline
  const suppliedIds = new Set(payload.evidenceAtoms.map(atom => atom.evidenceId))
  const identityTemplate = resume.evidenceAtoms.find(atom => atom.claimType === 'identity')
  const timelineTemplate = resume.evidenceAtoms.find(atom => atom.claimType === 'timeline')
  const identityAtoms = payload.identityAndTimeline.identity.name.evidenceIds
    .filter(evidenceId => !suppliedIds.has(evidenceId) && identityTemplate)
    .map(evidenceId => ({ ...structuredClone(identityTemplate!), evidenceId }))
  const timelineAtoms = payload.identityAndTimeline.timeline.flatMap(timeline => (
    timeline.evidenceIds
      .filter(evidenceId => !suppliedIds.has(evidenceId) && timelineTemplate)
      .map(evidenceId => ({
        ...structuredClone(timelineTemplate!),
        evidenceId,
        sourceScopeId: timeline.scopeId,
      }))
  ))
  resume.evidenceAtoms = [...identityAtoms, ...timelineAtoms, ...payload.evidenceAtoms]
  return renderSourcePreservingArtifact({ resume, plan: payload.resumePlan })
}

function createCompositionFromEnvelope(payload: TestEnvelopePayload): P06CompositionOutput {
  if (payload.writingPolicy && payload.blueprint) {
    const facts = new Map((payload.facts ?? payload.blueprint.slots.flatMap(slot => slot.facts ?? [])).map(fact => [fact.evidenceId, fact.text]))
    return {
      contractVersion: P06_COMPOSITION_CONTRACT_VERSION,
      blocks: payload.blueprint.slots.map(slot => ({
        slotId: slot.slotId, evidenceIds: slot.allowedEvidenceIds.slice(0, 1),
        text: slot.kind === 'summary' ? '参与团队产品迭代，具有功能交付实践。'
          : slot.kind === 'skill' && payload.skillPolicy ? '产品迭代协作：参与团队功能交付。'
          : facts.get(slot.allowedEvidenceIds[0])!.replace('参与团队产品迭代，交付3个功能。', '参与团队产品迭代并交付3个功能。'),
      })),
    }
  }
  if (!payload.blueprint || !payload.evidenceAtoms) {
    throw new Error('composition fixture needs the server blueprint and evidence catalog')
  }
  const atomById = new Map(payload.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const usedBodyEvidenceIds = new Set<string>()
  return {
    contractVersion: P06_COMPOSITION_CONTRACT_VERSION,
    blocks: payload.blueprint.slots.map(slot => {
      const evidenceIds = slot.kind === 'summary'
        ? slot.allowedEvidenceIds.slice(0, 1)
        : slot.allowedEvidenceIds.filter(id => !usedBodyEvidenceIds.has(id))
      const selectedEvidenceIds = evidenceIds.length > 0
        ? evidenceIds
        : slot.allowedEvidenceIds.slice(0, 1)
      if (slot.kind !== 'summary') {
        for (const evidenceId of selectedEvidenceIds) usedBodyEvidenceIds.add(evidenceId)
      }
      const atoms = selectedEvidenceIds.map(id => atomById.get(id))
      if (atoms.some(atom => !atom)) throw new Error(`missing composition evidence for ${slot.slotId}`)
      return {
        slotId: slot.slotId,
        evidenceIds: selectedEvidenceIds,
        text: atoms.map(atom => atom!.verbatimText).join('；'),
      }
    }),
  }
}

function createDslFromEnvelope(payload: TestEnvelopePayload): P06DslOutput {
  if (!payload.blueprint || !payload.evidenceAtoms) {
    throw new Error('DSL fixture needs the server blueprint and evidence catalog')
  }
  const usedBodyEvidenceIds = new Set<string>()
  return {
    contractVersion: P06_DSL_CONTRACT_VERSION,
    blocks: payload.blueprint.slots.map(slot => {
      const evidenceIds = slot.kind === 'summary'
        ? slot.allowedEvidenceIds.slice(0, 1)
        : slot.allowedEvidenceIds.filter(id => !usedBodyEvidenceIds.has(id))
      const selectedEvidenceIds = evidenceIds.length > 0
        ? evidenceIds
        : slot.allowedEvidenceIds.slice(0, 1)
      if (slot.kind !== 'summary') {
        for (const evidenceId of selectedEvidenceIds) usedBodyEvidenceIds.add(evidenceId)
      }
      return {
        slotId: slot.slotId,
        operations: selectedEvidenceIds.map(evidenceId => ({
          op: 'emit_atom' as const,
          evidenceId,
        })),
        joiner: selectedEvidenceIds.length === 1 ? 'none' as const : 'semicolon' as const,
      }
    }),
  }
}

function createPlan(payload: { strategyProfile: ResumeStrategyProfile; generationPolicy: GenerationPolicy }): V5ResumePlan {
  const resume = createResumeFixture().bundle
  const job = createJobFixture().bundle
  const match = createMatchFixture().match
  const deliverable = resume.evidenceAtoms.find(item => item.claimType === 'deliverable')!
  const skill = resume.evidenceAtoms.find(item => item.claimType === 'skill')!
  const core = job.requirementAtoms.find(item => item.importance === 'core_outcome')!
  const must = job.requirementAtoms.find(item => item.importance === 'must_have')!
  const scope = resume.timeline[0]
  return {
    schemaVersion: V5_SCHEMA_VERSION,
    strategyProfile: payload.strategyProfile,
    generationPolicy: payload.generationPolicy,
    targetValueProposition: match.positioning.statement,
    primaryRequirementIds: [core.requirementId, must.requirementId],
    stableCoreEvidenceIds: [deliverable.evidenceId],
    customizedEvidenceIds: [skill.evidenceId],
    evidencePillars: [
      { pillarId: 'p1', title: '产品交付', requirementIds: [core.requirementId], evidenceIds: [deliverable.evidenceId], role: 'career_anchor' },
      { pillarId: 'p2', title: 'SQL', requirementIds: [must.requirementId], evidenceIds: [skill.evidenceId], role: 'jd_primary' },
    ],
    scopePlans: [{
      scopeId: scope.scopeId,
      scopeType: scope.kind,
      treatment: 'compress',
      selectedEvidenceIds: [deliverable.evidenceId],
      bulletBudget: 1,
      rewriteAngle: '保留参与和团队边界',
    }],
    featuredSkillEvidenceIds: [skill.evidenceId],
    safeKeywordMappings: [{ requirementId: must.requirementId, evidenceIds: [skill.evidenceId], safePhrase: 'SQL' }],
    forbiddenRequirementIds: [],
    omittedHighValueEvidence: [],
    lowerBoundException: null,
  }
}

class RoutingProvider implements LlmProvider {
  readonly p08EvidenceAtoms: EvidenceAtom[][] = []
  readonly p08Payloads: TestEnvelopePayload[] = []
  readonly promptVersions: string[] = []
  p11Calls = 0
  advisoryOmission = false
  throwP06 = false
  throwP06C = false
  throwP06D = false
  throwP08 = false
  invalidP06Schema = false
  invalidP06CSchema = false
  invalidP06DSchema = false
  truncateP06D = false

  constructor(
    private readonly blockFactJudge = false,
    private readonly forceDraftRepair = false,
    private readonly forcePlanFailure = false,
    private readonly forceSafeFallback = false,
    private readonly blockQualityJudge = false,
    private readonly lowScoreQualityPass = false,
    private readonly recoverQualityAfterRepair = false
  ) {}

  async complete(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    const version = input.promptVersion ?? ''
    this.promptVersions.push(version)
    const envelope = parseEnvelope(input)
    if (version.includes('-p08-')) {
      this.p08Payloads.push(structuredClone(envelope.payload))
      this.p08EvidenceAtoms.push(envelope.payload.evidenceAtoms ?? [])
    }
    if (this.throwP06C && version.includes('-p06c-')) throw new Error('fixture P06C provider failure')
    if (this.throwP06D && version.includes('-p06d-')) throw new Error('fixture P06D provider failure')
    if (this.throwP06 && version.includes('-p06-')) throw new Error('fixture P06 provider failure')
    if (this.throwP08 && version.includes('-p08-')) throw new Error('fixture P08 provider failure')
    if (this.invalidP06Schema && version.includes('-p06-')) {
      return {
        provider: 'fake',
        model: 'fixture',
        content: '{"schemaVersion":"5.0.0"}',
        latencyMs: 1,
        inputTokens: 10,
        outputTokens: 10,
      }
    }
    if (this.invalidP06CSchema && version.includes('-p06c-')) {
      return {
        provider: 'fake',
        model: 'fixture',
        content: JSON.stringify({ contractVersion: P06_COMPOSITION_CONTRACT_VERSION }),
        latencyMs: 1,
        inputTokens: 10,
        outputTokens: 10,
      }
    }
    if (this.invalidP06DSchema && version.includes('-p06d-')) {
      return {
        provider: 'fake',
        model: 'fixture',
        content: JSON.stringify({ contractVersion: P06_DSL_CONTRACT_VERSION }),
        latencyMs: 1,
        inputTokens: 10,
        outputTokens: 10,
      }
    }
    let value: unknown
    if (version.includes('-p01-')) {
      value = createResumeFixture().candidate
    }
    else if (version.includes('-p02-')) value = createJobFixture().candidate
    else if (version.includes('-p03-')) value = createMatchFromEnvelope(envelope.payload)
    else if (version.includes('-p05-') || version.includes('-p05r-')) {
      const plan = version.includes('-p05r-')
        ? structuredClone(envelope.payload.currentOutput!)
        : createPlan({
            strategyProfile: envelope.payload.strategyProfile!,
            generationPolicy: envelope.payload.generationPolicy!,
          })
      if (this.forcePlanFailure) {
        plan.scopePlans[0].treatment = 'expand'
        plan.scopePlans[0].bulletBudget = 2
      }
      value = plan
    }
    else if (version.includes('-p06c-')) {
      value = createCompositionFromEnvelope(envelope.payload)
      if (this.forceSafeFallback) {
        const composition = value as P06CompositionOutput
        composition.blocks[0].text = `${composition.blocks[0].text}（模型新增内容）`
      }
    }
    else if (version.includes('-p06d-')) {
      value = createDslFromEnvelope(envelope.payload)
      if (this.forceSafeFallback) {
        const dsl = value as P06DslOutput
        dsl.blocks[0].operations[0].evidenceId = 'ev_not_allowed_by_blueprint'
      }
    }
    else if (version.includes('-p06-')) {
      value = createArtifactFromEnvelope(envelope.payload)
      if (this.forceDraftRepair) {
        const artifact = value as GeneratedResumeArtifact
        artifact.claims.at(-1)!.claimId = artifact.claims[0].claimId
      }
      if (this.forceSafeFallback) {
        const artifact = value as GeneratedResumeArtifact
        artifact.markdown = artifact.markdown.replace('### 甲公司', '### 假公司')
      }
      if (this.advisoryOmission) {
        const artifact = value as GeneratedResumeArtifact
        const skillClaim = artifact.claims.find(claim => claim.outputPath.startsWith('skills'))!
        artifact.markdown = artifact.markdown.replace(skillClaim.outputText, '')
        artifact.claims = artifact.claims.filter(claim => claim.claimId !== skillClaim.claimId)
      }
    } else if (version.includes('-p07-')) value = envelope.payload.draftArtifact
    else if (version.includes('-p09-')) {
      const claims = envelope.payload.artifact!.claims
      value = {
        schemaVersion: V5_SCHEMA_VERSION,
        passed: !this.blockFactJudge,
        auditedClaimCount: claims.length,
        issues: this.blockFactJudge ? [{
          issueId: 'judge_issue_1',
          severity: 'error',
          code: 'claim_mapping_insufficient',
          claimId: claims[0]?.claimId ?? null,
          evidenceIds: [],
          message: '测试阻断',
          safeRepairDirection: '删除无证据主张',
        }] : [],
      }
    } else if (version.includes('-p11-')) {
      this.p11Calls += 1
      const shouldBlockQuality = this.blockQualityJudge
        && !(this.recoverQualityAfterRepair && this.p11Calls > 1)
      value = {
        schemaVersion: V5_SCHEMA_VERSION,
        evaluatorId: 'fixture-quality-judge',
        dimensions: [
          'job_specificity',
          'evidence_selection',
          'career_coherence',
          'result_expression',
          'conciseness_readability',
          'deliverability',
        ].map(name => ({
          name,
          score: (shouldBlockQuality || this.lowScoreQualityPass) && name === 'deliverability' ? 2 : 10,
          maxScore: 10,
          evidence: [],
          issues: shouldBlockQuality && name === 'deliverability'
            ? ['简历内容不足，不能直接投递']
            : [],
        })),
        deliverabilityGate: shouldBlockQuality ? 'fail' : 'pass',
        factualIncidentCandidates: [],
      }
    } else if (version.includes('-p08-')) {
      value = createArtifactFromEnvelope(envelope.payload)
      if (this.forceSafeFallback) {
        const artifact = value as GeneratedResumeArtifact
        artifact.markdown = artifact.markdown.replace('### 甲公司', '### 假公司')
      }
    } else throw new Error(`unexpected prompt version: ${version}`)

    if (version.includes('-p01-') || version.includes('-p01r-')) {
      const candidate = value as ResumeExtractionCandidate
      value = { ...candidate, factCandidates: candidate.factCandidates.map(({
        blockRelativeSpan, verbatimText, normalizedClaim, numericAtoms, ...annotation
      }) => annotation) }
    }
    const parsed = input.structuredOutput?.schema.safeParse(value)
    if (parsed && !parsed.success) throw new Error(`fake output schema mismatch: ${parsed.error.message}`)
    return {
      provider: 'fake',
      model: 'fixture',
      content: JSON.stringify(value),
      finishReason: this.truncateP06D && version.includes('-p06d-') ? 'length' : 'stop',
      latencyMs: 1,
      inputTokens: 10,
      outputTokens: 10,
    }
  }
}

class ResumeExtractionCacheProbeProvider implements LlmProvider {
  p01Calls = 0
  p02Calls = 0

  async complete(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    const version = input.promptVersion ?? ''
    const envelope = parseEnvelope(input)
    let value: unknown
    if (version.includes('-p01-')) {
      this.p01Calls += 1
      value = createResumeFixture().candidate
    } else if (version.includes('-p02-')) {
      this.p02Calls += 1
      const document = envelope.payload.canonicalJobDocument
      if (!document || document.blocks.length < 2) throw new Error('cache probe needs at least two JD blocks')
      const [titleBlock, ...requirementBlocks] = document.blocks
      const candidate: JobExtractionCandidate = {
        schemaVersion: V5_SCHEMA_VERSION,
        basicInfo: { title: titleBlock.text, company: null, location: null },
        basicInfoSourceBlockIds: [titleBlock.sourceBlockId],
        requirementCandidates: requirementBlocks.map((block, index) => ({
          requirementLocalId: `r${index + 1}`,
          sourceBlockId: block.sourceBlockId,
          blockRelativeSpan: { start: 0, end: block.text.length },
          verbatimText: block.text,
          normalizedRequirement: block.text,
          category: index === requirementBlocks.length - 1 ? 'skill' : 'responsibility',
          importance: index === requirementBlocks.length - 1 ? 'must_have' : 'core_outcome',
          logicGroupLocalId: null,
          logicOperator: null,
          explicitness: 'explicit',
        })),
        explicitCompanySignals: [],
        explicitLocationSignals: [],
        uncertainties: [],
        sourcedContextCandidates: [],
        unmappedFragments: [],
        coverageClaim: {
          mappedSourceBlockIds: document.blocks.map(block => block.sourceBlockId),
          unmappedSourceBlockIds: [],
        },
      }
      value = candidate
    } else {
      throw new Error('cache probe completed after P01/P02')
    }

    return {
      provider: 'fake',
      model: 'fixture',
      content: JSON.stringify(value),
      latencyMs: 1,
      inputTokens: 10,
      outputTokens: 10,
    }
  }
}

class TruncatedResumeExtractionProvider implements LlmProvider {
  p01Calls = 0
  p01RepairCalls = 0
  p02Calls = 0

  async complete(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    const version = input.promptVersion ?? ''
    if (version.includes('-p01r-')) {
      this.p01RepairCalls += 1
      throw new Error('P01R must not run after a transport truncation')
    }
    if (version.includes('-p01-')) {
      this.p01Calls += 1
      return {
        provider: 'fake',
        model: 'fixture',
        content: '{"schemaVersion":"5.0.0","factCandidates":[',
        finishReason: 'length',
        latencyMs: 1,
        inputTokens: 10,
        outputTokens: 16_000,
      }
    }
    if (version.includes('-p02-')) {
      this.p02Calls += 1
      return {
        provider: 'fake',
        model: 'fixture',
        content: JSON.stringify(createJobFixture().candidate),
        finishReason: 'stop',
        latencyMs: 1,
        inputTokens: 10,
        outputTokens: 10,
      }
    }
    throw new Error(`unexpected prompt after extraction truncation: ${version}`)
  }
}

class PartitionNormalizationProbeProvider implements LlmProvider {
  p01Calls = 0
  p01RepairCalls = 0

  async complete(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    const version = input.promptVersion ?? ''
    const payload = parseEnvelope(input).payload
    if (version.includes('-p01r-')) {
      this.p01RepairCalls += 1
      throw new Error('P01R must not run for exact-source overlap')
    }
    if (!version.includes('-p01-')) throw new Error(`unexpected prompt: ${version}`)
    this.p01Calls += 1
    const document = payload.canonicalSourceDocument
    if (!document || document.blocks.length !== 1) throw new Error('partition probe expects one source block')
    const candidate = createExcludedResumeCandidate(document)
    const block = document.blocks[0]
    const nestedStart = block.text.indexOf('推动版本上线')
    if (nestedStart < 0) throw new Error('partition probe source is missing nested text')
    candidate.factCandidates.push({
      ...structuredClone(candidate.factCandidates[0]),
      factLocalId: 'nested_overlap',
      blockRelativeSpan: { start: nestedStart, end: block.text.length },
      verbatimText: block.text.slice(nestedStart),
      normalizedClaim: block.text.slice(nestedStart),
    })
    return {
      provider: 'fake',
      model: 'fixture',
      content: JSON.stringify(candidate),
      finishReason: 'stop',
      latencyMs: 1,
      inputTokens: 10,
      outputTokens: 10,
    }
  }
}

class NormalizedRepairEnvelopeProbeProvider implements LlmProvider {
  repairPayload: TestEnvelopePayload | null = null

  async complete(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    const version = input.promptVersion ?? ''
    const payload = parseEnvelope(input).payload
    const isRepair = version.includes('-p01r-')
    if (!isRepair && !version.includes('-p01-')) throw new Error(`unexpected prompt: ${version}`)
    const document = isRepair
      ? payload.originalEnvelope?.payload?.canonicalSourceDocument
      : payload.canonicalSourceDocument
    if (!document) throw new Error('repair envelope probe is missing source document')
    const candidate = createExcludedResumeCandidate(document)
    if (isRepair) {
      this.repairPayload = structuredClone(payload)
    } else {
      candidate.factCandidates[0] = {
        ...candidate.factCandidates[0],
        claimType: 'result',
        sourceScopeLocalId: 'work1',
        proposedStatus: 'source_supported',
        riskFlags: [],
        numericAtoms: [{
          raw: '4个',
          valueText: '4',
          unit: '个',
          qualifier: null,
          period: null,
          ownerScope: 'work1',
        }],
      }
    }
    return {
      provider: 'fake',
      model: 'fixture',
      content: JSON.stringify(candidate),
      finishReason: 'stop',
      latencyMs: 1,
      inputTokens: 10,
      outputTokens: 10,
    }
  }
}

function createExcludedResumeCandidate(document: CanonicalSourceDocument): ResumeExtractionCandidate {
  const factCandidates = document.blocks.map(block => ({
    factLocalId: `f_${block.sourceBlockId}`,
    sourceBlockId: block.sourceBlockId,
    blockRelativeSpan: { start: 0, end: block.text.length },
    verbatimText: block.text,
    normalizedClaim: block.text,
    claimType: 'other' as const,
    sourceScopeLocalId: 'excluded_unresolved',
    proposedStatus: 'excluded' as const,
    attributionLevel: 'unspecified' as const,
    sourceActionVerb: null,
    qualifiers: [],
    numericAtoms: [],
    riskFlags: ['uncertain' as const],
  }))
  return {
    schemaVersion: V5_SCHEMA_VERSION,
    identityCandidates: [],
    timelineCandidates: [],
    sectionCandidates: [],
    factCandidates,
    unmappedFragments: [],
    conflicts: [],
    coverageClaim: {
      mappedSourceBlockIds: document.blocks.map(block => block.sourceBlockId),
      unmappedSourceBlockIds: [],
    },
    qualityAssessment: {
      scoreInputs: {
        identityCompleteness: 0,
        timelineCompleteness: 0,
        evidenceResultDensity: 0,
        clarity: 0,
        sectionCoverage: 100,
      },
      strengths: [],
      weaknesses: [],
      suggestions: [],
      capabilitySummary: '',
    },
  }
}

function createShardedExtractionFixture() {
  const resumeMarkdown = [
    '# 工作经历',
    ...Array.from({ length: 8 }, (_, index) => [
      `## 测试${index + 1}公司 | 产品经理`,
      `测试${index + 1}公司`,
      '产品经理',
      '2020.01-2020.12',
      `- 负责产品交付${'甲'.repeat(700)}`,
    ].join('\n')),
  ].join('\n')
  const document = canonicalizeSourceDocument(resumeMarkdown, 'scheduler-test').canonicalDocument
  return { resumeMarkdown, document, chunks: splitResumeDocument(document) }
}

class ResumeExtractionRepairBudgetProvider implements LlmProvider {
  p01Calls = 0
  p01RepairCalls = 0
  downstreamCalls = 0
  activeP01Calls = 0
  maxConcurrentP01Calls = 0
  readonly requests: Array<{ component: 'P01' | 'P01R'; shardIndex: number }> = []
  readonly primaryCompletionOrder: number[] = []

  constructor(private readonly behavior: {
    failedPrimaries: number[]
    failedRepairs?: number[]
    schemaFailure?: boolean
    reverseCompletion?: boolean
    truncatedPrimary?: number
  }) {}

  async complete(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    const version = input.promptVersion ?? ''
    const payload = parseEnvelope(input).payload
    const isRepair = version.includes('-p01r-')
    if (!isRepair && !version.includes('-p01-')) {
      this.downstreamCalls += 1
      throw new Error(`unexpected prompt: ${version}`)
    }
    const originalPayload = isRepair ? payload.originalEnvelope?.payload : payload
    const document = originalPayload?.canonicalSourceDocument
    const shardIndex = originalPayload?.extractionSequence?.index
    if (!document) throw new Error('missing P01 chunk document')
    if (shardIndex === undefined) throw new Error('missing server-owned P01 sequence')

    this.requests.push({ component: isRepair ? 'P01R' : 'P01', shardIndex })
    if (isRepair) this.p01RepairCalls += 1
    else this.p01Calls += 1

    this.activeP01Calls += 1
    this.maxConcurrentP01Calls = Math.max(this.maxConcurrentP01Calls, this.activeP01Calls)
    const delay = this.behavior.reverseCompletion && !isRepair && shardIndex % 2 === 0 ? 4 : 1
    for (let tick = 0; tick < delay; tick += 1) await Promise.resolve()
    this.activeP01Calls -= 1
    if (!isRepair) this.primaryCompletionOrder.push(shardIndex)

    if (!isRepair && shardIndex === this.behavior.truncatedPrimary) {
      return {
        provider: 'fake',
        model: 'fixture',
        content: '{"schemaVersion":"5.0.0","factCandidates":[',
        finishReason: 'length',
        latencyMs: 1,
        inputTokens: 10,
        outputTokens: 16_000,
      }
    }

    const valid = createExcludedResumeCandidate(document)
    const shouldFail = isRepair
      ? this.behavior.failedRepairs?.includes(shardIndex)
      : this.behavior.failedPrimaries.includes(shardIndex)
    if (shouldFail && !this.behavior.schemaFailure) {
      valid.factCandidates[0] = {
        ...valid.factCandidates[0],
        verbatimText: `${valid.factCandidates[0].verbatimText}不存在`,
        normalizedClaim: `${valid.factCandidates[0].normalizedClaim}不存在`,
      }
    }
    return {
      provider: 'fake',
      model: 'fixture',
      content: JSON.stringify(shouldFail && this.behavior.schemaFailure
        ? { ...valid, factCandidates: 'private-schema-canary@example.test' }
        : valid),
      finishReason: 'stop',
      latencyMs: 1,
      inputTokens: 10,
      outputTokens: 10,
    }
  }
}

describe('v5 production adaptive workflow', () => {
  test('allocates more extraction time to large workflows while reserving downstream time', () => {
    expect(calculateResumeExtractionTimeoutMs(900000)).toBe(600000)
    expect(calculateResumeExtractionTimeoutMs(600000)).toBe(420000)
    expect(calculateResumeExtractionTimeoutMs(240000)).toBe(240000)
  })

  test('classifies final structure failures from blocking issues only and includes timelines', () => {
    const issue = (code: string, severity: 'error' | 'warning') => ({
      issueId: `issue-${code}`,
      severity,
      code,
      outputPath: 'artifact',
      claimId: null,
      evidenceIds: [],
      requirementIds: [],
      message: code,
      expectedConstraint: code,
      replacementText: null,
    })

    expect(hasV5BlockingStructureIssue([
      issue('STRUCTURAL_HEADING_CLAIM_SERVER_PRUNED', 'warning'),
      issue('NUMBER_MISMATCH', 'error'),
    ])).toBe(false)
    expect(hasV5BlockingStructureIssue([
      issue('PLANNED_TIMELINE_MISSING', 'error'),
    ])).toBe(true)
  })

  test('allows P08 only for the complete pure-structural allowlist', () => {
    const issue = (code: string) => ({
      issueId: 'issue-structural',
      severity: 'error' as const,
      code,
      outputPath: 'claims',
      claimId: null,
      evidenceIds: [],
      requirementIds: [],
      message: 'duplicate',
      expectedConstraint: 'unique',
      replacementText: null,
    })
    const structuralCodes = [
      'BUDGET_EXCEEDED',
      'CLAIM_TEXT_AMBIGUOUS',
      'CLAIM_TEXT_NOT_FOUND',
      'DUPLICATE_CLAIM_ID',
      'EMPTY_SCOPE',
      'HEADING_POLICY_VIOLATION',
      'SECTION_ORDER_MISMATCH',
      'TRANSFORMATION_CONTRACT_MISMATCH',
    ]
    const directRendererCodes = [
      'NUMBER_MISMATCH',
      'UNPROVABLE_CLAIM_TEXT',
      'MARKDOWN_SCOPE_ATTRIBUTION_MISMATCH',
      'UNMAPPED_OUTPUT_CLAIM',
      'SENSITIVE_PII_LEAK',
      'INTERNAL_AUDIT_LEAK',
    ]

    for (const code of structuralCodes) expect(shouldAttemptV5ArtifactRepair([issue(code)])).toBe(true)
    for (const code of directRendererCodes) expect(shouldAttemptV5ArtifactRepair([issue(code)])).toBe(false)
    expect(shouldAttemptV5ArtifactRepair([issue('DUPLICATE_CLAIM_ID'), issue('NUMBER_MISMATCH')])).toBe(false)
  })

  test('keeps excluded audit evidence out of model planning context', () => {
    const bundle = structuredClone(createResumeFixture().bundle)
    const excluded = bundle.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
    excluded.status = 'excluded'
    excluded.riskFlags = ['uncertain']
    bundle.unmappedFragments = [{ sourceBlockId: excluded.sourceBlockId, text: excluded.verbatimText, reason: 'test', importance: 'high' }]
    bundle.conflicts = [{
      conflictId: 'conflict_test',
      evidenceIds: [excluded.evidenceId],
      description: 'test ambiguity',
      resolution: 'needs_user_confirmation',
    }]

    const safe = buildModelSafeResumeEvidenceBundle(bundle)

    expect(safe.evidenceAtoms.some(atom => atom.evidenceId === excluded.evidenceId)).toBe(false)
    expect(safe.timeline.flatMap(item => item.evidenceIds)).not.toContain(excluded.evidenceId)
    expect(safe.sections.flatMap(item => item.evidenceIds)).not.toContain(excluded.evidenceId)
    expect(safe.unmappedFragments).toEqual([])
    expect(safe.conflicts).toEqual([])
  })

  test('sends P03 a compact evidence catalog without contact or provenance payloads', () => {
    const resume = createResumeFixture().bundle
    const job = createJobFixture().bundle
    const resumeContext = buildCompactMatchingResumeContext(resume)
    const jobContext = buildCompactMatchingJobContext(job)

    expect(Object.keys(resumeContext).sort()).toEqual([
      'conflicts',
      'evidenceAtoms',
      'extractionCoverage',
      'sourceDocument',
      'timeline',
    ])
    expect(Object.keys(resumeContext.evidenceAtoms[0]).sort()).toEqual([
      'attributionLevel',
      'claimType',
      'evidenceId',
      'normalizedClaim',
      'numericAtoms',
      'qualifiers',
      'riskFlags',
      'sourceActionVerb',
      'sourceScopeId',
      'status',
      'verbatimText',
    ])
    expect(Object.keys(jobContext).sort()).toEqual([
      'basicInfo',
      'explicitCompanySignals',
      'explicitLocationSignals',
      'requirementAtoms',
      'sourcedContext',
      'uncertainties',
    ])
    expect(Object.keys(jobContext.requirementAtoms[0]).sort()).toEqual([
      'category',
      'explicitness',
      'importance',
      'logicGroupId',
      'logicOperator',
      'normalizedRequirement',
      'requirementId',
      'verbatimText',
    ])
    expect(resumeContext).not.toHaveProperty('identity')
    expect(resumeContext.sourceDocument).toEqual({ primaryLanguage: resume.sourceDocument.primaryLanguage })
    expect(resumeContext.evidenceAtoms[0]).not.toHaveProperty('sourceDocumentHash')
    expect(resumeContext.evidenceAtoms[0]).not.toHaveProperty('sourceBlockId')
    expect(resumeContext.evidenceAtoms[0]).not.toHaveProperty('sourceSpan')
    expect(jobContext.requirementAtoms[0]).not.toHaveProperty('sourceBlockId')
    expect(jobContext.requirementAtoms[0]).not.toHaveProperty('sourceSpan')
    expect(JSON.stringify(resumeContext).length).toBeLessThan(JSON.stringify(resume).length)
    expect(JSON.stringify(jobContext).length).toBeLessThan(JSON.stringify(job).length)
  })

  test('exposes a typed extract-only result without entering P02 or later stages', async () => {
    const provider = new ResumeExtractionCacheProbeProvider()
    const workflow = new V5ResumeOptimizationWorkflow({ provider, enableDefaultSubscribers: false })

    const result: V5ResumeExtractionResult = await workflow.extractResume({ resumeMarkdown: FIXTURE_RESUME })

    expect(result.state).toBe('resume_extracted')
    expect(result.releaseStatus).toBe('preproduction_candidate')
    expect(result.canonicalSourceDocument.sha256).toBe(result.resumeEvidenceBundle.sourceDocument.sha256)
    expect(result.resumeExtractionCandidate.factCandidates).toHaveLength(4)
    expect(result.resumeEvidenceBundle.evidenceAtoms).toHaveLength(4)
    expect(provider.p01Calls).toBe(1)
    expect(provider.p02Calls).toBe(0)
  })

  test('reuses the trusted P01 cache through the extract-only entry', async () => {
    const provider = new ResumeExtractionCacheProbeProvider()
    const resumeExtractionCache = createTrustedResumeExtractionCache({
      implementationFingerprint: 'extract-only-workflow-test-implementation',
      providerConfigFingerprint: 'extract-only-workflow-test-provider',
    })
    const workflow = new V5ResumeOptimizationWorkflow({
      provider,
      resumeExtractionCache,
      enableDefaultSubscribers: false,
    })

    const first = await workflow.extractResume({ resumeMarkdown: FIXTURE_RESUME })
    const second = await workflow.extractResume({ resumeMarkdown: FIXTURE_RESUME })

    expect(first.resumeEvidenceBundle.evidenceAtoms).toEqual(second.resumeEvidenceBundle.evidenceAtoms)
    expect(provider.p01Calls).toBe(1)
    expect(provider.p02Calls).toBe(0)
    expect(resumeExtractionCache.stats()).toMatchObject({ hits: 1, misses: 1, entries: 1 })
  })

  test('maps an indivisible extraction scope over capacity to blocked input without calling the provider', async () => {
    const provider = new ResumeExtractionCacheProbeProvider()
    const workflow = new V5ResumeOptimizationWorkflow({ provider, enableDefaultSubscribers: false })
    const oversizedResume = `# 工作经历\n## 甲公司\n${'甲'.repeat(1_001)}`

    await expect(workflow.extractResume({ resumeMarkdown: oversizedResume }))
      .rejects.toMatchObject({
        code: 'P01_LOGICAL_SCOPE_CAPACITY_EXCEEDED',
        state: 'blocked_input_validation',
      })
    expect(provider.p01Calls).toBe(0)
    expect(provider.p02Calls).toBe(0)
  })

  test('maps a deterministic scope-plan preflight failure without calling P01, P01R or P02', async () => {
    const provider = new TruncatedResumeExtractionProvider()
    const workflow = new V5ResumeOptimizationWorkflow({
      provider,
      enableDefaultSubscribers: false,
      pluginOverrides: {
        'resume-extraction': {
          id: 'resume-extraction',
          version: 'test-invalid-scope-plan',
          stage: 'extract',
          dependencies: ['canonical-source'],
          run: () => {
            throw new ResumeExtractionChunkPlanError('test deterministic ownership mismatch')
          },
        },
      },
    })

    await expect(workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD }))
      .rejects.toMatchObject({ code: 'P01_SCOPE_PLAN_INVALID', state: 'blocked_input_validation' })
    expect(provider.p01Calls).toBe(0)
    expect(provider.p01RepairCalls).toBe(0)
    expect(provider.p02Calls).toBe(0)
  })

  test('does not spend a P01R call when extract-only output is truncated', async () => {
    const provider = new TruncatedResumeExtractionProvider()
    const workflow = new V5ResumeOptimizationWorkflow({ provider, enableDefaultSubscribers: false })

    await expect(workflow.extractResume({ resumeMarkdown: FIXTURE_RESUME }))
      .rejects.toMatchObject({
        code: 'V5_OUTPUT_TRUNCATED',
        state: 'provider_failure',
        retryable: false,
        httpStatus: 502,
      })
    expect(provider.p01Calls).toBe(1)
    expect(provider.p01RepairCalls).toBe(0)
  })

  test('does not spend a repair call after P01 output is truncated', async () => {
    const provider = new TruncatedResumeExtractionProvider()
    const workflow = new V5ResumeOptimizationWorkflow({ provider, enableDefaultSubscribers: false })

    await expect(workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD }))
      .rejects.toMatchObject({
        code: 'V5_OUTPUT_TRUNCATED',
        state: 'provider_failure',
        retryable: false,
        httpStatus: 502,
      })
    expect(provider.p01Calls).toBe(1)
    expect(provider.p01RepairCalls).toBe(0)
    expect(provider.p02Calls).toBe(0)
  })

  test('coalesces exact-source P01 overlap in code and spends no P01R call', async () => {
    const provider = new PartitionNormalizationProbeProvider()
    const eventBus = createHarnessEventBus()
    const events: HarnessEvent[] = []
    eventBus.subscribe('*', event => { events.push(event) })
    const workflow = new V5ResumeOptimizationWorkflow({ provider, eventBus, enableDefaultSubscribers: false })

    const result = await workflow.extractResume({
      resumeMarkdown: '负责用户研究并形成需求清单；推动版本上线并完成验收交付',
    })

    expect(result.state).toBe('resume_extracted')
    expect(result.resumeExtractionCandidate.factCandidates).toHaveLength(1)
    expect(events.filter(e => e.type === 'extraction.validation.observed').map(e => e.payload))
      .toContainEqual(expect.objectContaining({ component: 'P01', outcome: 'passed', retention: expect.objectContaining({
        targetBlocks: 1, rawFactBlocks: 1, rawMissingBlocks: 0, finalAccountedBlocks: 1, serverAddedFactBlocks: 0,
      }) }))
    expect(result.resumeEvidenceBundle.extractionCoverage.warnings)
      .toContain('FACT_CANDIDATE_PARTITION_SERVER_COALESCED')
    expect(provider.p01Calls).toBe(1)
    expect(provider.p01RepairCalls).toBe(0)
  })

  test('sends P01R the server-normalized candidate and unresolved errors only', async () => {
    const provider = new NormalizedRepairEnvelopeProbeProvider()
    const eventBus = createHarnessEventBus()
    const events: HarnessEvent[] = []
    eventBus.subscribe('*', event => { events.push(event) })
    const workflow = new V5ResumeOptimizationWorkflow({ provider, eventBus, enableDefaultSubscribers: false })

    const result = await workflow.extractResume({ resumeMarkdown: '交付3个功能' })
    const currentOutput = provider.repairPayload?.currentOutput as unknown as ResumeExtractionCandidate
    const validationIssues = provider.repairPayload?.validationIssues as Array<{ code: string; severity: string }>
    expect(events.filter(e => e.type === 'extraction.validation.observed').map(e => e.payload))
      .toContainEqual(expect.objectContaining({ component: 'P01R', outcome: 'passed', retention: expect.objectContaining({
        targetBlocks: 1, rawMissingBlocks: 0, finalAccountedBlocks: 1,
      }) }))

    expect(result.state).toBe('resume_extracted')
    expect(currentOutput.factCandidates[0].numericAtoms[0].raw).toBe('3个')
    expect(validationIssues.every(issue => issue.severity === 'error')).toBe(true)
    expect(validationIssues.map(issue => issue.code)).toContain('BUSINESS_FACT_WITHOUT_TIMELINE')
    expect(validationIssues.map(issue => issue.code)).not.toContain('NUMERIC_ATOMS_SERVER_ALIGNED')
  })

  test('finishes every primary before ordered repairs and recovers four invalid shards', async () => {
    const { resumeMarkdown, document, chunks } = createShardedExtractionFixture()
    expect(chunks).toHaveLength(8)
    const failedPrimaries = [0, 1, 4, 6]
    const provider = new ResumeExtractionRepairBudgetProvider({ failedPrimaries, reverseCompletion: true })
    const workflow = new V5ResumeOptimizationWorkflow({ provider, enableDefaultSubscribers: false })

    const result = await workflow.extractResume({ resumeMarkdown })

    expect(result.state).toBe('resume_extracted')
    expect(provider.p01Calls).toBe(chunks.length)
    expect(provider.p01RepairCalls).toBe(4)
    expect(provider.maxConcurrentP01Calls).toBe(2)
    expect(provider.primaryCompletionOrder).toEqual([1, 0, 3, 2, 5, 4, 7, 6])
    expect(provider.requests).toEqual([
      ...chunks.map((_, shardIndex) => ({ component: 'P01' as const, shardIndex })),
      ...failedPrimaries.map(shardIndex => ({ component: 'P01R' as const, shardIndex })),
    ])
    expect(result.resumeExtractionCandidate.factCandidates.map(fact => fact.sourceBlockId))
      .toEqual(document.blocks.map(block => block.sourceBlockId))
    expect(provider.downstreamCalls).toBe(0)
  })

  test('blocks above the half-shard repair ceiling before calling the provider and retains unresolved issues', async () => {
    const { resumeMarkdown, chunks } = createShardedExtractionFixture()
    const failedPrimaries = chunks.map((_, index) => index)
    const provider = new ResumeExtractionRepairBudgetProvider({ failedPrimaries, reverseCompletion: true })
    const eventBus = createHarnessEventBus()
    const events: HarnessEvent[] = []
    eventBus.subscribe('*', event => { events.push(event) })
    const workflow = new V5ResumeOptimizationWorkflow({ provider, eventBus, enableDefaultSubscribers: false })

    let error: unknown
    try {
      await workflow.extractResume({ resumeMarkdown })
    } catch (caught) {
      error = caught
    }

    const hardLimit = resumeExtractionMaxRepairBudget(chunks.length)
    expect(failedPrimaries.length).toBeGreaterThan(hardLimit)
    expect(error).toBeInstanceOf(V5WorkflowBlockedError)
    expect(error).toMatchObject({ code: 'P01_REPAIR_BUDGET_EXHAUSTED', state: 'blocked_input_validation' })
    const issues = (error as V5WorkflowBlockedError).issues
    expect(issues.length).toBeGreaterThanOrEqual(chunks.length)
    expect(issues.every(issue => issue.severity === 'error')).toBe(true)
    expect(issues.map(issue => issue.code)).toContain('SOURCE_QUOTE_NOT_FOUND')
    expect(provider.p01Calls).toBe(chunks.length)
    expect(provider.p01RepairCalls).toBe(0)
    expect(provider.requests.filter(request => request.component === 'P01R').map(request => request.shardIndex))
      .toEqual([])
    const observations = events.filter(event => event.type === 'extraction.validation.observed')
      .map(event => event.payload)
    expect(observations.filter(observation => observation.component === 'P01')).toHaveLength(chunks.length)
    expect(observations.at(-1)).toMatchObject({
      shardIndex: failedPrimaries[0],
      component: 'P01R',
      attempt: 1,
      layer: 'repair_gate',
      outcome: 'blocked_before_call',
      issueBuckets: [{ code: 'P01_REPAIR_BUDGET_EXHAUSTED', severity: 'error', pathCategory: 'root', count: 1 }],
    })
  })

  test('stops later repairs when one repaired shard still fails domain validation', async () => {
    const { resumeMarkdown, chunks } = createShardedExtractionFixture()
    const provider = new ResumeExtractionRepairBudgetProvider({ failedPrimaries: [0, 2, 4], failedRepairs: [2] })
    const eventBus = createHarnessEventBus()
    const events: HarnessEvent[] = []
    eventBus.subscribe('*', event => { events.push(event) })
    const workflow = new V5ResumeOptimizationWorkflow({ provider, eventBus, enableDefaultSubscribers: false })

    await expect(workflow.extractResume({ resumeMarkdown }))
      .rejects.toMatchObject({ code: 'P01_VALIDATION_FAILED', state: 'blocked_input_validation' })

    expect(provider.p01Calls).toBe(chunks.length)
    expect(provider.requests.filter(request => request.component === 'P01R').map(request => request.shardIndex))
      .toEqual([0, 2])
    expect(events.filter(event => event.type === 'extraction.validation.observed').at(-1)?.payload)
      .toMatchObject({ shardIndex: 2, component: 'P01R', layer: 'domain', outcome: 'failed' })
    expect(provider.downstreamCalls).toBe(0)
  })

  test('resumes a failed extraction from validated shard checkpoints across workflow and cache instances', async () => {
    const { resumeMarkdown, document, chunks } = createShardedExtractionFixture()
    const cacheOptions = {
      implementationFingerprint: 'workflow-partial-checkpoint-v1',
      providerConfigFingerprint: 'scheduler-fixture-provider-v1',
    }
    const firstCache = createTrustedResumeExtractionCache(cacheOptions)
    const firstProvider = new ResumeExtractionRepairBudgetProvider({
      failedPrimaries: [0, 2, 4],
      failedRepairs: [2],
      reverseCompletion: true,
    })
    const firstWorkflow = new V5ResumeOptimizationWorkflow({
      provider: firstProvider,
      resumeExtractionCache: firstCache,
      enableDefaultSubscribers: false,
    })

    await expect(firstWorkflow.extractResume({ resumeMarkdown }))
      .rejects.toMatchObject({ code: 'P01_VALIDATION_FAILED' })

    const validatedShardIndices = [0, 1, 3, 5, 6, 7]
    const missingShardIndices = [2, 4]
    expect(firstProvider.p01Calls).toBe(chunks.length)
    expect(firstProvider.requests.filter(request => request.component === 'P01R').map(request => request.shardIndex))
      .toEqual([0, 2])
    expect(firstCache.snapshot(document)).toBeNull()
    expect(firstCache.progress(document)).toEqual({
      shardCount: chunks.length,
      validatedShardIndices,
      missingShardIndices,
      complete: false,
    })
    const partial = firstCache.partialSnapshot(document)
    expect(partial?.shards.map(shard => shard.index)).toEqual(validatedShardIndices)
    if (!partial) throw new Error('failed extraction must retain validated shard checkpoints')

    const resumedCache = createTrustedResumeExtractionCache(cacheOptions)
    resumedCache.hydratePartial(document, structuredClone(partial))
    const resumedProvider = new ResumeExtractionRepairBudgetProvider({ failedPrimaries: [] })
    const resumedWorkflow = new V5ResumeOptimizationWorkflow({
      provider: resumedProvider,
      resumeExtractionCache: resumedCache,
      enableDefaultSubscribers: false,
    })

    const result = await resumedWorkflow.extractResume({ resumeMarkdown })

    expect(result.state).toBe('resume_extracted')
    expect(resumedProvider.requests).toEqual(missingShardIndices.map(shardIndex => ({
      component: 'P01' as const,
      shardIndex,
    })))
    expect(resumedProvider.p01RepairCalls).toBe(0)
    expect(resumedProvider.downstreamCalls).toBe(0)
    expect(result.resumeExtractionCandidate.factCandidates.map(fact => fact.sourceBlockId))
      .toEqual(document.blocks.map(block => block.sourceBlockId))
    expect(validateResumeExtractionCandidate(document, result.resumeExtractionCandidate, {
      trustedShardCount: chunks.length,
    }).passed).toBe(true)
    expect(resumedCache.snapshot(document)?.candidate).toEqual(result.resumeExtractionCandidate)
    expect(resumedCache.progress(document)).toEqual({
      shardCount: chunks.length,
      validatedShardIndices: chunks.map((_, index) => index),
      missingShardIndices: [],
      complete: true,
    })
  })

  test('records safe schema issue codes for failed P01 and P01R without exposing provider content', async () => {
    const provider = new ResumeExtractionRepairBudgetProvider({
      failedPrimaries: [0],
      failedRepairs: [0],
      schemaFailure: true,
    })
    const eventBus = createHarnessEventBus()
    const events: HarnessEvent[] = []
    eventBus.subscribe('*', event => { events.push(event) })
    const workflow = new V5ResumeOptimizationWorkflow({ provider, eventBus, enableDefaultSubscribers: false })

    await expect(workflow.extractResume({ resumeMarkdown: FIXTURE_RESUME }))
      .rejects.toMatchObject({ code: 'V5_SCHEMA_VALIDATION_FAILED' })

    const observations = events.filter(event => event.type === 'extraction.validation.observed')
      .map(event => event.payload)
    expect(observations).toHaveLength(2)
    for (const [index, observation] of observations.entries()) {
      expect(observation).toMatchObject({
        component: index === 0 ? 'P01' : 'P01R',
        attempt: index,
        layer: 'schema',
        outcome: 'failed',
        issueBuckets: [{ code: 'SCHEMA_INVALID_TYPE', severity: 'error', pathCategory: 'fact', count: 1 }],
      })
    }
    expect(JSON.stringify(observations)).not.toContain('private-schema-canary')
    expect(JSON.stringify(observations)).not.toContain('factCandidates')
    expect(provider.p01Calls).toBe(1)
    expect(provider.p01RepairCalls).toBe(1)
    expect(provider.downstreamCalls).toBe(0)
  })

  test('settles the active primary batch after truncation without repairing or starting downstream work', async () => {
    const { resumeMarkdown } = createShardedExtractionFixture()
    const provider = new ResumeExtractionRepairBudgetProvider({
      failedPrimaries: [1],
      truncatedPrimary: 0,
    })
    const eventBus = createHarnessEventBus()
    const events: HarnessEvent[] = []
    eventBus.subscribe('*', event => { events.push(event) })
    const workflow = new V5ResumeOptimizationWorkflow({ provider, eventBus, enableDefaultSubscribers: false })

    await expect(workflow.run({ resumeMarkdown, jobDescription: FIXTURE_JD }))
      .rejects.toMatchObject({ code: 'V5_OUTPUT_TRUNCATED', state: 'provider_failure' })

    expect(provider.p01Calls).toBe(2)
    expect(provider.primaryCompletionOrder).toHaveLength(2)
    expect(provider.p01RepairCalls).toBe(0)
    expect(provider.downstreamCalls).toBe(0)
    expect(events.filter(event => event.type === 'extraction.validation.observed').map(event => event.payload))
      .toContainEqual(expect.objectContaining({
        shardIndex: 0,
        component: 'P01',
        layer: 'schema',
        outcome: 'failed',
        issueBuckets: [{ code: 'V5_OUTPUT_TRUNCATED', severity: 'error', pathCategory: 'root', count: 1 }],
      }))
  })

  test('runs P01 only once for the same resume with two different JDs when a trusted cache is shared', async () => {
    const provider = new ResumeExtractionCacheProbeProvider()
    const resumeExtractionCache = createTrustedResumeExtractionCache({
      implementationFingerprint: 'workflow-test-implementation',
      providerConfigFingerprint: 'workflow-test-provider',
    })
    const workflow = new V5ResumeOptimizationWorkflow({
      provider,
      judgeProvider: provider,
      resumeExtractionCache,
      enableDefaultSubscribers: false,
    })
    const jobDescriptions = [
      FIXTURE_JD,
      '数据产品经理\n负责指标体系建设与跨团队推进\n要求熟练使用SQL',
    ]

    let analysisSucceeded = 0
    for (const jobDescription of jobDescriptions) {
      try {
        await workflow.run({
          resumeMarkdown: FIXTURE_RESUME, jobDescription,
          onAnalysisSucceeded: () => {
            expect(provider.p02Calls).toBe(analysisSucceeded)
            analysisSucceeded += 1
          },
        })
        throw new Error('expected cache probe to stop after extraction')
      } catch (error) {
        expect(error).toBeInstanceOf(V5WorkflowBlockedError)
        expect((error as V5WorkflowBlockedError).code).toBe('V5_PROVIDER_REQUEST_FAILED')
      }
    }

    expect(provider.p01Calls).toBe(1)
    expect(provider.p02Calls).toBe(2)
    expect(analysisSucceeded).toBe(2)
    expect(resumeExtractionCache.stats()).toMatchObject({ hits: 1, misses: 1, entries: 1 })
  })

  test('stops before JD extraction when the analysis callback rejects', async () => {
    const provider = new ResumeExtractionCacheProbeProvider()
    const workflow = new V5ResumeOptimizationWorkflow({ provider, judgeProvider: provider, enableDefaultSubscribers: false })
    let charged = 0
    await expect(workflow.run({
      resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD,
      onAnalysisSucceeded: async () => { charged += 1; throw new Error('quota exhausted') },
    })).rejects.toBeInstanceOf(V5WorkflowBlockedError)
    expect(charged).toBe(1)
    expect(provider.p01Calls).toBe(1)
    expect(provider.p02Calls).toBe(0)
  })

  test('does not consume quota when resume extraction fails', async () => {
    const provider = new TruncatedResumeExtractionProvider()
    const workflow = new V5ResumeOptimizationWorkflow({ provider, judgeProvider: provider, enableDefaultSubscribers: false })
    let charged = 0
    await expect(workflow.run({
      resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD,
      onAnalysisSucceeded: () => { charged += 1 },
    })).rejects.toBeInstanceOf(V5WorkflowBlockedError)
    expect(charged).toBe(0)
  })

  test('runs the formal chain and only returns a gate-passed artifact', async () => {
    const provider = new RoutingProvider()
    const eventBus = createHarnessEventBus()
    const events: HarnessEvent[] = []
    eventBus.subscribe('*', event => { events.push(event) })
    const workflow = new V5ResumeOptimizationWorkflow({
      provider,
      judgeProvider: provider,
      eventBus,
      enableDefaultSubscribers: false,
    })
    const result = await workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD })
    expect(result.state).toBe('succeeded')
    expect(result.releaseStatus).toBe('preproduction_candidate')
    expect(result.artifact.markdown).toContain('参与团队产品迭代，交付3个功能')
    expect(result.usedSafeFallback).toBe(false)
    expect(result.usedAnyFallback).toBe(false)
    expect(result.qualityGates).toEqual({ factSafety: 'pass', contentCompleteness: 'pass', deliverability: 'pass' })
    expect(result.deliveryDecision).toBe('deliver')
    expect(result).not.toHaveProperty('interviewPreparation')
    expect(result.deliveryDiagnostics).toMatchObject({
      version: 'v5-delivery-diagnostics-v2',
      outcome: { execution: 'completed', disposition: 'deliverable' },
      tracks: {
        factSafety: { status: 'pass', finalIssueCounts: {} },
        productQuality: { status: 'pass', issueCounts: {} },
      },
      provenance: { artifactOrigin: 'server_compiler', usedSafeFallback: false, interview: 'deferred' },
    })
    expect(result.deliveryDiagnostics.metrics?.plannedEvidenceCoverage.denominator).toBeGreaterThan(0)
    const terminalPayload = events.find(event => event.type === 'workflow.succeeded')?.payload
    expect(terminalPayload).toMatchObject({
        artifactGeneration: {
          mode: 'dsl_v1',
          contractVersion: P06_DSL_CONTRACT_VERSION,
          compilerVersion: 'p06-composition-compiler-v2',
        },
        deliveryDiagnostics: result.deliveryDiagnostics,
      })
    expect(terminalPayload?.pluginManifest).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ pluginId: 'interview-preparation' }),
    ]))
    expect(provider.promptVersions.some(version => /-p0(?:7|9)-|-p11-/.test(version))).toBe(false)
    expect(provider.promptVersions.some(version => /-p05r?-/.test(version))).toBe(false)
    expect(provider.promptVersions.some(version => /-p10r?-/.test(version))).toBe(false)
    expect(provider.promptVersions.filter(version => version.includes('-p06d-'))).toHaveLength(1)
    expect(provider.promptVersions.filter(version => version.includes('-p06c-'))).toHaveLength(0)
    expect(provider.promptVersions.filter(version => version.includes('-p06-'))).toHaveLength(0)
    expect(provider.promptVersions.filter(version => version.includes('-p08-'))).toHaveLength(0)
    expect(provider.promptVersions).toHaveLength(4)
  })

  test('retains composition_v1 as an explicit artifact-generation kill switch', async () => {
    const provider = new RoutingProvider()
    const workflow = new V5ResumeOptimizationWorkflow({
      provider,
      enableDefaultSubscribers: false,
      artifactGenerationMode: 'composition_v1',
    })

    const result = await workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD })

    expect(result.state).toBe('succeeded')
    expect(provider.promptVersions.filter(version => version.includes('-p06c-'))).toHaveLength(1)
    expect(provider.promptVersions.filter(version => version.includes('-p06d-'))).toHaveLength(0)
    expect(provider.promptVersions.filter(version => version.includes('-p08-'))).toHaveLength(0)
  })

  test.each([
    ['transferable', undefined], ['weak_signal', undefined],
    ['transferable', 'document-editorial-v1'], ['weak_signal', 'document-editorial-v1'],
  ] as const)('targeted workflow with %s (%s) uses one profile, one fit map and one Writer with the same public result keys', async (status, editorialPolicy) => {
    const seen: TestEnvelopePayload[] = [], versions: string[] = []
    const delegate = new RoutingProvider()
    const analyses: JobFitMap[] = []
    const provider: LlmProvider = { complete: async input => {
      const payload = parseEnvelope(input).payload
      seen.push(payload); versions.push(input.promptVersion ?? '')
      if (input.promptVersion?.includes('-p02-') && payload.jobTargetingPolicy) {
        const candidate = createTargetingFixture().candidate
        candidate.jobSuccessProfile.candidatePortrait = { id: 'job:portrait:p1', text: '能理解需求并通过产品实践支持团队交付的人。',
          provenance: { basis: 'inferred', sourceBlockIds: ['B0002'], reason: '从产品任务综合。', confidence: 'medium' } }
        return { provider: 'fake', model: 'fixture', content: JSON.stringify(candidate), latencyMs: 1 }
      }
      if (input.promptVersion?.includes('-p03-') && payload.jobTargetingPolicy) {
        const business = payload.resumeContext!.facts.find(fact => fact.claimType === 'deliverable')!
        const fit: JobFitMap = { contractVersion: 'job-fit-map-v1',
          links: payload.targets!.map(target => ({ targetId: target.id, status, evidenceIds: [business.evidenceId], similarity: '具有相邻产品实践。', difference: '尚不等于完整岗位经验。', expressionAngle: '突出已有交付。' })),
          narratives: [{ statement: '具备团队产品交付实践。', targetIds: ['job:task:t1'], evidenceIds: [business.evidenceId] }], questions: [],
        }
        return { provider: 'fake', model: 'fixture', content: JSON.stringify(fit), latencyMs: 1 }
      }
      return delegate.complete(input)
    } }
    const workflow = new V5ResumeOptimizationWorkflow({ provider, enableDefaultSubscribers: false,
      artifactGenerationMode: 'writer_v1', jobTargetingPolicy: 'job-targeted-v1', writingEditorialPolicy: editorialPolicy,
      onTargetingAnalysis: async analysis => { analyses.push(analysis.fit) } })
    const result = await workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD })
    expect(result.state).toBe('succeeded')
    expect(versions).toHaveLength(4)
    expect(versions.find(version => version.includes('-p06c-'))).toBe(editorialPolicy
      ? '5.1.0-p06c-supported-writer-r19' : '5.1.0-p06c-supported-writer-r16')
    expect(versions.some(version => /-p0[589]-|-p12-|-p06d-/.test(version))).toBe(false)
    expect(analyses).toHaveLength(1)
    if (status === 'weak_signal') {
      expect(analyses[0].narratives).toEqual([])
      expect(versions.some(version => version.includes('-p03r-'))).toBe(false)
      expect(result.artifact.markdown).toContain('3个功能')
    }
    expect(seen.find(payload => payload.writingPolicy)?.jobTargeting?.tasks[0].id).toBe('job:task:t1')
    expect(seen.find(payload => payload.canonicalJobDocument)).not.toHaveProperty('resumeContext')
    expect(seen.find(payload => payload.resumeContext)).not.toHaveProperty('jobSuccessProfile.candidatePortrait')
    expect(result).not.toHaveProperty('jobSuccessProfile')
    expect(result).not.toHaveProperty('jobFitMap')
    expect(result.requirementAnalysis?.version).toBe('job-requirement-analysis-v1')
    expect(result.requirementAnalysis?.tasks[0]?.id).toBe('job:task:t1')
    expect(result.requirementAnalysis?.portrait?.id).toBe('job:portrait:p1')
    expect(result.artifact.markdown).not.toContain('job:task:')
  })

  test('targeting cannot be enabled with an incompatible artifact mode', () => {
    expect(() => new V5ResumeOptimizationWorkflow({ artifactGenerationMode: 'dsl_v1', jobTargetingPolicy: 'job-targeted-v1', enableDefaultSubscribers: false })).toThrow('JOB_TARGETING_REQUIRES_WRITER')
  })

  test('runs a single supported Writer with no P06D/P08/P09 call and keeps the public artifact shape', async () => {
    const provider = new RoutingProvider()
    const workflow = new V5ResumeOptimizationWorkflow({ provider, enableDefaultSubscribers: false, artifactGenerationMode: 'writer_v1' })
    const result = await workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD })
    expect(result.deliveryDecision).toBe('deliver')
    expect(result.releaseStatus).toBe('preproduction_candidate')
    expect(result.artifact.markdown).toContain('参与团队产品迭代并交付3个功能。')
    expect(result.usedSafeFallback).toBe(false)
    expect(provider.promptVersions).toHaveLength(4)
    expect(provider.promptVersions.filter(version => version.includes('-p06c-'))).toHaveLength(1)
    expect(provider.promptVersions.filter(version => /-p06d-|-p08-|-p09-/.test(version))).toEqual([])
  })

  test('Writer carries incidental omission warnings to the result without repairs or contradictory diagnostics', async () => {
    const delegate = new RoutingProvider(), versions: string[] = []
    const resumeMarkdown = FIXTURE_RESUME.replace('交付3个功能。', '交付3个功能；产品日活200K。')
    const provider: LlmProvider = { complete: async input => {
      versions.push(input.promptVersion ?? '')
      if (input.promptVersion?.includes('-p01-')) {
        const candidate = createResumeFixture().candidate
        const text = parseEnvelope(input).payload.canonicalSourceDocument!.blocks[2].text
        candidate.factCandidates[2].verbatimText = text
        candidate.factCandidates[2].normalizedClaim = text
        candidate.factCandidates[2].blockRelativeSpan.end = text.length
        return { provider: 'fake', model: 'fixture', content: JSON.stringify(candidate), latencyMs: 1 }
      }
      const response = await delegate.complete(input)
      if (input.promptVersion?.includes('-p06c-')) {
        const composition = JSON.parse(response.content) as P06CompositionOutput
        composition.blocks.forEach(block => { block.text = block.text.replace('；产品日活200K', '') })
        return { ...response, content: JSON.stringify(composition) }
      }
      return response
    } }
    const workflow = new V5ResumeOptimizationWorkflow({ provider, enableDefaultSubscribers: false, artifactGenerationMode: 'writer_v1' })
    const result = await workflow.run({ resumeMarkdown, jobDescription: FIXTURE_JD })
    expect(result.deliveryDecision).toBe('deliver')
    expect(result.validationIssues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'WRITER_SUPPORTING_DETAIL_OMITTED', severity: 'warning' })]))
    expect(result.deliveryDiagnostics.tracks.factSafety.status).toBe('pass')
    expect(versions).toHaveLength(4)
    expect(versions.some(version => /-p08-|-p09-|-p12-/.test(version))).toBe(false)
  })

  test.each([
    ['参与团队产品迭代。', 'blocked_quality_validation'],
    ['参与团队交付30个功能。', 'blocked_fact_validation'],
  ] as const)('classifies Writer failure without retry: %s', async (text, state) => {
    const delegate = new RoutingProvider()
    const provider: LlmProvider = { complete: async input => {
      const response = await delegate.complete(input)
      if (!input.promptVersion?.includes('-p06c-')) return response
      const composition = JSON.parse(response.content) as P06CompositionOutput
      composition.blocks.find(block => !block.slotId.startsWith('summary'))!.text = text
      return { ...response, content: JSON.stringify(composition) }
    } }
    const workflow = new V5ResumeOptimizationWorkflow({ provider, enableDefaultSubscribers: false, artifactGenerationMode: 'writer_v1' })
    await expect(workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD })).rejects.toMatchObject({ state })
    expect(delegate.promptVersions).toHaveLength(4)
  })

  test('builds the complete P05-shaped plan locally without a model call', async () => {
    const provider = new RoutingProvider()
    const workflow = new V5ResumeOptimizationWorkflow({ provider, judgeProvider: provider, enableDefaultSubscribers: false })

    const result = await workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD })

    expect(result.state).toBe('succeeded')
    expect(result.resumePlan.strategyProfile).toEqual(buildAdaptiveStrategy(createMatchFixture()).profile)
    expect(result.resumePlan.scopePlans[0]).toMatchObject({ treatment: 'compress', bulletBudget: 1 })
    expect(result.usedSafeFallback).toBe(false)
    expect(result.usedAnyFallback).toBe(false)
    expect(result.generationProvenance.planOrigin).toBe('deterministic_quality')
    expect(provider.promptVersions.some(version => /-p05r?-/.test(version))).toBe(false)
  })

  test('ignores the legacy judge flag and never calls P07, P09 or P11 in production', async () => {
    const provider = new RoutingProvider(false, false, false, false, true)
    const workflow = new V5ResumeOptimizationWorkflow({ provider, judgeProvider: provider, enableDefaultSubscribers: false })

    const result = await workflow.run({
      resumeMarkdown: FIXTURE_RESUME,
      jobDescription: FIXTURE_JD,
      enableQualityJudge: true,
    })

    expect(result.state).toBe('succeeded')
    expect(provider.p11Calls).toBe(0)
    expect(provider.promptVersions.some(version => /-p0(?:7|9)-|-p11-/.test(version))).toBe(false)
  })

  test('blocks advisory-only omissions without spending P08 or P10 calls', async () => {
    const provider = new RoutingProvider()
    provider.advisoryOmission = true
    const workflow = new V5ResumeOptimizationWorkflow({
      provider,
      judgeProvider: provider,
      enableDefaultSubscribers: false,
      artifactGenerationMode: 'legacy',
    })

    const result = await workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD })

    expect(result.state).toBe('blocked_quality_validation')
    expect(result.deliveryDecision).toBe('block')
    expect(result.qualityGates).toEqual({
      factSafety: 'pass',
      contentCompleteness: 'fail',
      deliverability: 'review_required',
    })
    expect(result.validationIssues).toContainEqual(expect.objectContaining({
      code: 'PLANNED_EVIDENCE_OMITTED',
      severity: 'warning',
    }))
    expect(result.deliveryDiagnostics.tracks.factSafety.status).toBe('pass')
    expect(result.deliveryDiagnostics.tracks.productQuality).toMatchObject({
      status: 'review_required',
      issueCounts: { PLANNED_EVIDENCE_OMITTED: 1 },
    })
    expect(provider.p08EvidenceAtoms).toHaveLength(0)
    expect(provider.promptVersions.some(version => /-p10r?-/.test(version))).toBe(false)
  })

  test('only exposes the plan and metadata evidence whitelist to P08 repair', async () => {
    const provider = new RoutingProvider(false, true)
    const workflow = new V5ResumeOptimizationWorkflow({
      provider,
      judgeProvider: provider,
      enableDefaultSubscribers: false,
      artifactGenerationMode: 'legacy',
    })
    const result = await workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD })
    expect(result.state).toBe('succeeded')
    expect(provider.p08EvidenceAtoms).toHaveLength(1)
    expect(provider.p08EvidenceAtoms[0]).toHaveLength(2)
    expect(provider.p08EvidenceAtoms[0].every(atom => !['identity', 'timeline'].includes(atom.claimType))).toBe(true)
    expect(provider.p08EvidenceAtoms[0].some(atom => atom.normalizedClaim === '额外未计划动作')).toBe(false)
    expect(provider.p08Payloads[0].repairMode).toBe('artifact_structural')
    expect(provider.p08Payloads[0]).not.toHaveProperty('originalEnvelope')
  })

  test('retains rejected-draft diagnostics in an internal-only safe fallback', async () => {
    const provider = new RoutingProvider(false, false, false, true)
    const eventBus = createHarnessEventBus()
    const events: HarnessEvent[] = []
    eventBus.subscribe('*', event => { events.push(event) })
    const workflow = new V5ResumeOptimizationWorkflow({
      provider,
      judgeProvider: provider,
      eventBus,
      enableDefaultSubscribers: false,
    })

    const result = await workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD })

    expect(result.state).toBe('blocked_quality_validation')
    expect(result.usedSafeFallback).toBe(true)
    expect(result.usedAnyFallback).toBe(true)
    expect(result.generationProvenance.artifactOrigin).toBe('server_renderer')
    expect(result.deliveryDecision).toBe('internal_only')
    expect(result.qualityGates).toEqual({
      factSafety: 'pass',
      contentCompleteness: 'fail',
      deliverability: 'fail',
    })
    expect(provider.p08EvidenceAtoms).toHaveLength(0)
    expect(provider.promptVersions.some(version => /-p10r?-/.test(version))).toBe(false)
    expect(result.validationIssues.some(item => item.severity === 'error')).toBe(false)
    expect(result.validationIssues.some(item => item.message.startsWith('已丢弃模型稿（P06D DSL 校验失败）：'))).toBe(true)
    expect(result.validationIssues.some(item => item.code === 'DSL_UNKNOWN_EVIDENCE')).toBe(true)
    expect(result.deliveryDiagnostics.tracks.factSafety.finalIssueCounts).toEqual({})
    expect(Object.keys(result.deliveryDiagnostics.tracks.factSafety.rejectedCandidateIssueCounts).length)
      .toBeGreaterThan(0)
    expect(result.deliveryDiagnostics.tracks.productQuality.status).toBe('fail')
    const terminalEvents = events.filter(event => [
      'workflow.succeeded',
      'workflow.failed',
      'workflow.partial',
    ].includes(event.type))
    expect(terminalEvents).toHaveLength(1)
    expect(terminalEvents[0]).toMatchObject({
      type: 'workflow.partial',
      payload: {
        errorCode: 'V5_PRODUCT_QUALITY_BLOCKED',
        errorMessage: expect.any(String),
        deliveryDecision: 'internal_only',
        qualityGates: result.qualityGates,
      },
    })
  })

  test('marks a non-deliverable artifact as skipped without calling P10', async () => {
    const provider = new RoutingProvider()
    provider.advisoryOmission = true
    const workflow = new V5ResumeOptimizationWorkflow({
      provider,
      enableDefaultSubscribers: false,
      artifactGenerationMode: 'legacy',
    })

    const result = await workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD })

    expect(result.deliveryDecision).toBe('block')
    expect(result).not.toHaveProperty('interviewPreparation')
    expect(result.deliveryDiagnostics.provenance.interview).toBe('skipped_by_gate')
    expect(provider.promptVersions.some(version => /-p10r?-/.test(version))).toBe(false)
  })

  test('surfaces P06D provider failures instead of disguising them as a safe fallback', async () => {
    const provider = new RoutingProvider()
    provider.throwP06D = true
    const eventBus = createHarnessEventBus()
    const events: HarnessEvent[] = []
    eventBus.subscribe('*', event => { events.push(event) })
    const workflow = new V5ResumeOptimizationWorkflow({ provider, eventBus, enableDefaultSubscribers: false })

    await expect(workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD }))
      .rejects.toMatchObject({
        code: 'V5_PROVIDER_REQUEST_FAILED',
        state: 'provider_failure',
        retryable: false,
        httpStatus: 502,
      })
    expect(provider.promptVersions.filter(version => version.includes('-p06d-'))).toHaveLength(1)
    expect(provider.promptVersions.filter(version => version.includes('-p06c-'))).toHaveLength(0)
    expect(provider.promptVersions.filter(version => version.includes('-p06-'))).toHaveLength(0)
    expect(provider.promptVersions.some(version => version.includes('-p08-'))).toBe(false)
    expect(provider.promptVersions.some(version => /-p10r?-/.test(version))).toBe(false)
    const failed = events.find(event => event.type === 'workflow.failed')
    expect(failed?.payload).toMatchObject({
      errorCode: 'V5_PROVIDER_REQUEST_FAILED',
      errorMessage: 'v5 工作流未完成。',
      deliveryDiagnostics: {
        outcome: { execution: 'failed', disposition: 'blocked_terminal' },
        tracks: {
          factSafety: { status: 'not_run' },
          productQuality: { status: 'not_run' },
        },
        provenance: { interview: 'not_reached' },
        metrics: null,
      },
    })
    expect(failed?.payload).not.toHaveProperty('issueSummaries')
    expect(JSON.stringify(failed?.payload)).not.toContain('fixture P06D provider failure')
  })

  test('surfaces P06D truncation without calling P08 or rendering a fallback', async () => {
    const provider = new RoutingProvider()
    provider.truncateP06D = true
    const workflow = new V5ResumeOptimizationWorkflow({ provider, enableDefaultSubscribers: false })

    await expect(workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD }))
      .rejects.toMatchObject({
        code: 'V5_OUTPUT_TRUNCATED',
        state: 'provider_failure',
        retryable: false,
        httpStatus: 502,
      })
    expect(provider.promptVersions.filter(version => version.includes('-p06d-'))).toHaveLength(1)
    expect(provider.promptVersions.filter(version => version.includes('-p08-'))).toHaveLength(0)
    expect(provider.promptVersions.some(version => /-p10r?-/.test(version))).toBe(false)
  })

  test('renders internal-only fallback after a P06D schema failure without calling P08', async () => {
    const provider = new RoutingProvider()
    provider.invalidP06DSchema = true
    const workflow = new V5ResumeOptimizationWorkflow({
      provider,
      enableDefaultSubscribers: false,
    })

    const result = await workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD })

    expect(result.state).toBe('blocked_quality_validation')
    expect(result.deliveryDecision).toBe('internal_only')
    expect(result.usedSafeFallback).toBe(true)
    expect(result.generationProvenance.artifactOrigin).toBe('server_renderer')
    expect(result.validationIssues).toContainEqual(expect.objectContaining({
      code: 'V5_SCHEMA_VALIDATION_FAILED',
      severity: 'warning',
    }))
    expect(provider.promptVersions.filter(version => version.includes('-p06d-'))).toHaveLength(1)
    expect(provider.promptVersions.filter(version => version.includes('-p06c-'))).toHaveLength(0)
    expect(provider.promptVersions.filter(version => version.includes('-p08-'))).toHaveLength(0)
    expect(provider.promptVersions.some(version => /-p10r?-/.test(version))).toBe(false)
  })

  test('surfaces the only P08 provider failure instead of rendering a fallback', async () => {
    const provider = new RoutingProvider(false, true)
    provider.throwP08 = true
    const workflow = new V5ResumeOptimizationWorkflow({
      provider,
      enableDefaultSubscribers: false,
      artifactGenerationMode: 'legacy',
    })

    await expect(workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD }))
      .rejects.toMatchObject({
        code: 'V5_PROVIDER_REQUEST_FAILED',
        state: 'provider_failure',
        retryable: false,
        httpStatus: 502,
      })
    expect(provider.promptVersions.filter(version => version.includes('-p08-'))).toHaveLength(1)
    expect(provider.promptVersions.some(version => /-p10r?-/.test(version))).toBe(false)
  })

  test('never calls P08 twice when P06 schema repair fails', async () => {
    const provider = new RoutingProvider()
    provider.invalidP06Schema = true
    provider.throwP08 = true
    const workflow = new V5ResumeOptimizationWorkflow({
      provider,
      enableDefaultSubscribers: false,
      artifactGenerationMode: 'legacy',
    })

    await expect(workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD }))
      .rejects.toMatchObject({
        code: 'V5_PROVIDER_REQUEST_FAILED',
        state: 'provider_failure',
        retryable: false,
        httpStatus: 502,
      })
    expect(provider.promptVersions.filter(version => version.includes('-p08-'))).toHaveLength(1)
    expect(Object.keys(provider.p08Payloads[0]).sort()).toEqual([
      'previousArtifact',
      'repairAttempt',
      'repairMode',
      'validationIssues',
    ])
    expect(provider.p08Payloads[0].repairMode).toBe('schema_only')
    expect(provider.promptVersions.some(version => /-p10r?-/.test(version))).toBe(false)
  })
})
