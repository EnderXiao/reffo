import { describe, expect, test } from 'bun:test'
import type { ChatCompletionInput, ChatCompletionResult, LlmProvider } from '@/providers/llm-provider'
import { buildAdaptiveStrategy } from '@/v5/adaptive-policy'
import { renderSourcePreservingArtifact } from '@/v5/safe-renderer'
import { createTrustedResumeExtractionCache } from '@/v5/resume-extraction-cache'
import { V6_STRICT_REVIEW_PROFILE } from '@/v5/plugins/execution-profile'
import { createJobFixture, createMatchFixture, createResumeFixture, FIXTURE_JD, FIXTURE_RESUME } from '@/v5/tests/fixtures'
import type {
  CanonicalSourceDocument,
  EvidenceAtom,
  GeneratedResumeArtifact,
  GenerationPolicy,
  JobExtractionCandidate,
  ResumeStrategyProfile,
  V5ResumeExtractionResult,
  V5ResumePlan,
} from '@/v5/types'
import { V5_SCHEMA_VERSION } from '@/v5/types'
import {
  buildModelSafeResumeEvidenceBundle,
  calculateResumeExtractionTimeoutMs,
  V5ResumeOptimizationWorkflow,
  V5WorkflowBlockedError,
} from '@/v5/main/workflow'

interface TestEnvelopePayload {
  strategyProfile?: ResumeStrategyProfile
  generationPolicy?: GenerationPolicy
  resumePlan?: V5ResumePlan
  currentOutput?: V5ResumePlan
  draftArtifact?: GeneratedResumeArtifact
  artifact?: GeneratedResumeArtifact
  evidenceAtoms?: EvidenceAtom[]
  canonicalJobDocument?: CanonicalSourceDocument
}

function parseEnvelope(input: ChatCompletionInput) {
  const content = input.messages.find(message => message.role === 'user')?.content ?? ''
  const match = content.match(/UNTRUSTED_INPUT_JSON:\n([\s\S]+?)\n\n只返回本阶段/)
  if (!match) throw new Error('missing test envelope')
  return JSON.parse(match[1]) as { payload: TestEnvelopePayload }
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
  readonly promptVersions: string[] = []

  constructor(
    private readonly blockFactJudge = false,
    private readonly forceDraftRepair = false,
    private readonly forcePlanFailure = false,
    private readonly forceSafeFallback = false
  ) {}

  async complete(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    const version = input.promptVersion ?? ''
    this.promptVersions.push(version)
    const envelope = parseEnvelope(input)
    let value: unknown
    if (version.includes('-p01-')) {
      const { document, candidate } = createResumeFixture()
      if (this.forceDraftRepair) {
        const block = document.blocks[2]
        const verbatimText = '交付3个功能'
        const start = block.text.indexOf(verbatimText)
        candidate.factCandidates.push({
          ...structuredClone(candidate.factCandidates[2]),
          factLocalId: 'f_extra_unplanned',
          blockRelativeSpan: { start, end: start + verbatimText.length },
          verbatimText,
          normalizedClaim: '额外未计划动作',
          claimType: 'other',
        })
      }
      value = candidate
    }
    else if (version.includes('-p02-')) value = createJobFixture().candidate
    else if (version.includes('-p03-')) value = createMatchFixture().match
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
    else if (version.includes('-p06-')) {
      const plan = createPlan({
        strategyProfile: buildAdaptiveStrategy(createMatchFixture()).profile,
        generationPolicy: envelope.payload.resumePlan!.generationPolicy,
      })
      value = renderSourcePreservingArtifact({ resume: createResumeFixture().bundle, plan })
      if (this.forceDraftRepair || this.forceSafeFallback) {
        const artifact = value as GeneratedResumeArtifact
        artifact.markdown = artifact.markdown.replace('### 甲公司', '### 假公司')
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
    } else if (version.includes('-p10-')) {
      const fixture = createMatchFixture()
      const scopeId = fixture.resume.timeline[0].scopeId
      const evidenceId = fixture.deliverable.evidenceId
      const requirementIds = fixture.job.requirementAtoms.map(item => item.requirementId)
      value = {
        schemaVersion: V5_SCHEMA_VERSION,
        questions: [
          ['如何规划产品？', 'core_task'],
          ['请深挖该交付经历。', 'project_deep_dive'],
          ['如何诚实说明差距？', 'gap_or_transfer'],
          ['若优先级变化会如何处理？', 'context_scenario'],
        ].map(([question, category]) => ({ question, category, relatedRequirementIds: requirementIds, relatedEvidenceIds: [evidenceId], preparationFocus: '基于真实证据准备', assumptionContextIds: [] })),
        storyRecommendations: [{ title: '产品交付', scopeId, evidenceIds: [evidenceId], background: '准备真实背景', knownResult: null, preparationGap: '补充可核验反馈' }],
        followUpQuestions: [
          { question: '成功标准是什么？', purpose: '确认成功标准', relatedRequirementIds: requirementIds, assumptionContextIds: [] },
          { question: '当前优先挑战是什么？', purpose: '确认挑战', relatedRequirementIds: requirementIds, assumptionContextIds: [] },
          { question: '如何协作？', purpose: '确认协作方式', relatedRequirementIds: requirementIds, assumptionContextIds: [] },
        ],
      }
    } else if (version.includes('-p08-')) {
      this.p08EvidenceAtoms.push(envelope.payload.evidenceAtoms ?? [])
      value = renderSourcePreservingArtifact({ resume: createResumeFixture().bundle, plan: envelope.payload.resumePlan! })
      if (this.forceSafeFallback) {
        const artifact = value as GeneratedResumeArtifact
        artifact.markdown = artifact.markdown.replace('### 甲公司', '### 假公司')
      }
    } else throw new Error(`unexpected prompt version: ${version}`)

    const parsed = input.structuredOutput?.schema.safeParse(value)
    if (parsed && !parsed.success) throw new Error(`fake output schema mismatch: ${parsed.error.message}`)
    return { provider: 'fake', model: 'fixture', content: JSON.stringify(value), latencyMs: 1, inputTokens: 10, outputTokens: 10 }
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

describe('v5 production adaptive workflow', () => {
  test('allocates more extraction time to large workflows while reserving downstream time', () => {
    expect(calculateResumeExtractionTimeoutMs(900000)).toBe(600000)
    expect(calculateResumeExtractionTimeoutMs(600000)).toBe(420000)
    expect(calculateResumeExtractionTimeoutMs(240000)).toBe(240000)
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

  test('does not spend a P01R call when extract-only output is truncated', async () => {
    const provider = new TruncatedResumeExtractionProvider()
    const workflow = new V5ResumeOptimizationWorkflow({ provider, enableDefaultSubscribers: false })

    await expect(workflow.extractResume({ resumeMarkdown: FIXTURE_RESUME }))
      .rejects.toMatchObject({ code: 'V5_OUTPUT_TRUNCATED', state: 'provider_failure' })
    expect(provider.p01Calls).toBe(1)
    expect(provider.p01RepairCalls).toBe(0)
  })

  test('does not spend a repair call after P01 output is truncated', async () => {
    const provider = new TruncatedResumeExtractionProvider()
    const workflow = new V5ResumeOptimizationWorkflow({ provider, enableDefaultSubscribers: false })

    await expect(workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD }))
      .rejects.toMatchObject({ code: 'V5_OUTPUT_TRUNCATED', state: 'provider_failure' })
    expect(provider.p01Calls).toBe(1)
    expect(provider.p01RepairCalls).toBe(0)
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

    for (const jobDescription of jobDescriptions) {
      try {
        await workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription })
        throw new Error('expected cache probe to stop after extraction')
      } catch (error) {
        expect(error).toBeInstanceOf(V5WorkflowBlockedError)
        expect((error as V5WorkflowBlockedError).code).toBe('V5_PROVIDER_OR_WORKFLOW_FAILURE')
      }
    }

    expect(provider.p01Calls).toBe(1)
    expect(provider.p02Calls).toBe(2)
    expect(resumeExtractionCache.stats()).toMatchObject({ hits: 1, misses: 1, entries: 1 })
  })

  test('runs the formal chain and only returns a gate-passed artifact', async () => {
    const provider = new RoutingProvider()
    const workflow = new V5ResumeOptimizationWorkflow({ provider, judgeProvider: provider, enableDefaultSubscribers: false })
    const result = await workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD })
    expect(result.state).toBe('succeeded')
    expect(result.releaseStatus).toBe('preproduction_candidate')
    expect(result.artifact.markdown).toContain('参与团队产品迭代，交付3个功能')
    expect(result.usedSafeFallback).toBe(false)
    expect(provider.promptVersions.some(version => version.includes('-p05-'))).toBe(false)
    expect(provider.promptVersions.some(version => version.includes('-p07-'))).toBe(false)
    expect(provider.promptVersions.some(version => version.includes('-p10-'))).toBe(false)
    expect(result.interviewPreparation).toBeUndefined()
  })

  test('keeps LLM planning and final review available through a strict plugin profile', async () => {
    const provider = new RoutingProvider()
    const workflow = new V5ResumeOptimizationWorkflow({
      provider,
      judgeProvider: provider,
      enableDefaultSubscribers: false,
      executionProfile: V6_STRICT_REVIEW_PROFILE,
    })

    const result = await workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD })

    expect(result.state).toBe('succeeded')
    expect(provider.promptVersions.some(version => version.includes('-p05-'))).toBe(true)
    expect(provider.promptVersions.some(version => version.includes('-p07-'))).toBe(true)
    expect(provider.promptVersions.some(version => version.includes('-p10-'))).toBe(true)
  })

  test('uses a deterministic valid plan when P05 and P05R both remain invalid', async () => {
    const provider = new RoutingProvider(false, false, true)
    const workflow = new V5ResumeOptimizationWorkflow({ provider, judgeProvider: provider, enableDefaultSubscribers: false })

    const result = await workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD })

    expect(result.state).toBe('succeeded')
    expect(result.resumePlan.strategyProfile).toEqual(buildAdaptiveStrategy(createMatchFixture()).profile)
    expect(result.resumePlan.scopePlans[0]).toMatchObject({ treatment: 'compress', bulletBudget: 1 })
    expect(result.usedSafeFallback).toBe(false)
  })

  test('fails closed when the blocking fact judge cannot establish a claim mapping', async () => {
    const provider = new RoutingProvider(true)
    const workflow = new V5ResumeOptimizationWorkflow({ provider, judgeProvider: provider, enableDefaultSubscribers: false })
    try {
      await workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD })
      throw new Error('expected v5 workflow to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(V5WorkflowBlockedError)
      expect((error as V5WorkflowBlockedError).state).toBe('blocked_fact_validation')
      expect((error as V5WorkflowBlockedError).code).toBe('V5_BLOCKING_FACT_JUDGE_FAILED')
      expect(provider.promptVersions.some(version => version.includes('-p08-'))).toBe(false)
    }
  })

  test('only exposes the plan and metadata evidence whitelist to P08 repair', async () => {
    const provider = new RoutingProvider(false, true)
    const workflow = new V5ResumeOptimizationWorkflow({ provider, judgeProvider: provider, enableDefaultSubscribers: false })
    const result = await workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD })
    expect(result.state).toBe('succeeded')
    expect(provider.p08EvidenceAtoms).toHaveLength(1)
    expect(provider.p08EvidenceAtoms[0]).toHaveLength(4)
    expect(provider.p08EvidenceAtoms[0].some(atom => atom.normalizedClaim === '额外未计划动作')).toBe(false)
  })

  test('retains the deterministic errors that triggered a successful safe fallback', async () => {
    const provider = new RoutingProvider(false, false, false, true)
    const workflow = new V5ResumeOptimizationWorkflow({ provider, judgeProvider: provider, enableDefaultSubscribers: false })

    const result = await workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD })

    expect(result.state).toBe('succeeded_with_safe_fallback')
    expect(result.usedSafeFallback).toBe(true)
    expect(result.validationIssues.some(item => item.severity === 'error')).toBe(true)
    expect(result.validationIssues.some(item => /HEADING|SCOPE/.test(item.code))).toBe(true)
  })
})
