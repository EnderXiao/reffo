import { describe, expect, test } from 'bun:test'
import type { ChatCompletionInput, LlmProvider } from '@/providers/llm-provider'
import { runDoubleOrderBlindAb } from '@/v5/ab-evaluator'
import { toLegacyMvpProcessResponse } from '@/v5/main/compatibility'
import { V5WorkflowBlockedError } from '@/v5/main/workflow'
import {
  createHistoricalV5ResultWithInterviewPreparation,
  createV5ResultFixture,
} from '@/v5/tests/fixtures'
import type { V5WorkflowResult } from '@/v5/types'
import { V5_SCHEMA_VERSION } from '@/v5/types'

function parsePromptPayload(input: ChatCompletionInput) {
  const content = input.messages.find(message => message.role === 'user')?.content ?? ''
  const match = content.match(/UNTRUSTED_INPUT_JSON:\n([\s\S]+?)\n\n只返回本阶段/)
  return JSON.parse(match![1]).payload as {
    resumeEvidenceBundle: {
      identity: { name: { value: string | null }; email: { value: string | null }; phone: { value: string | null } }
      timeline: Array<{
        scopeId: string
        organization: string | null
        title: string | null
        start: string | null
        end: string | null
        evidenceIds: string[]
      }>
      evidenceAtoms: Array<{
        evidenceId: string
        claimType: string
        verbatimText: string
        normalizedClaim: string
        qualifiers: string[]
        numericAtoms: Array<{ raw: string }>
      }>
      conflicts: Array<{ conflictId: string; evidenceIds: string[]; description: string }>
    } & Record<string, unknown>
    jobRequirementBundle: {
      requirementAtoms: Array<{
        requirementId: string
        verbatimText: string
        normalizedRequirement: string
        category: string
        importance: string
        logicGroupId: string | null
        logicOperator: string | null
        explicitness: string
      }>
    } & Record<string, unknown>
    candidates: Array<{ candidateId: 'A' | 'B'; markdown: string }>
    originalJob: { available: boolean; blocks: Array<{ sourceBlockId: string; text: string; inputRiskFlags: string[] }> }
  }
}

function parseCandidates(input: ChatCompletionInput) {
  return parsePromptPayload(input).candidates
}

class AbProvider implements LlmProvider {
  async complete(input: ChatCompletionInput) {
    const candidates = parseCandidates(input)
    const leftId = candidates.find(item => item.markdown.startsWith('LEFT'))!.candidateId
    const dimensions = {
      factualFidelity: 25,
      jobSpecificity: 18,
      evidenceSelection: 14,
      highValueEvidenceRecall: 9,
      careerCoherence: 9,
      concisenessReadability: 9,
      deliverability: 10,
    }
    const evaluation = {
      schemaVersion: V5_SCHEMA_VERSION,
      evaluations: candidates.map(item => ({
        candidateId: item.candidateId,
        absoluteGate: 'pass',
        dimensions: item.candidateId === leftId ? dimensions : { ...dimensions, jobSpecificity: 10 },
        unsupportedClaims: [],
        attributionErrors: [],
        emptyScopes: [],
        missingHighValueEvidence: [],
        internalAuditLeaks: [],
        strengths: ['可投递'],
        weaknesses: [],
      })),
      pairwise: { winner: leftId, confidence: 'high', reason: '左侧候选更有岗位针对性' },
    }
    return { provider: 'fake', model: 'ab', content: JSON.stringify(evaluation), latencyMs: 1 }
  }
}

class ControlledAbProvider extends AbProvider {
  calls = 0
  private releaseFirstCall!: () => void
  private readonly firstCallGate = new Promise<void>(resolve => { this.releaseFirstCall = resolve })

  releaseFirst() {
    this.releaseFirstCall()
  }

  override async complete(input: ChatCompletionInput) {
    this.calls += 1
    if (this.calls === 1) await this.firstCallGate
    return super.complete(input)
  }
}

describe('v5 compatibility and offline A/B', () => {
  test('preserves the legacy MVP response contract', () => {
    const response = toLegacyMvpProcessResponse(createV5ResultFixture())
    expect(response.agent_version).toBe('6.0.0')
    expect(response.workflow_status).toBe('succeeded')
    expect(response.step1_analysis.structured_resume.personal_info.name).toBe('张三')
    expect(response.step2_matching.match_score).toBeGreaterThan(0)
    expect(response.step3_optimized_resume).toContain('甲公司')
    expect(response.step4_interview_suggestions).toBeUndefined()
    expect(Object.keys(response).sort()).toEqual([
      'agent_state',
      'agent_version',
      'release_status',
      'run_id',
      'step1_analysis',
      'step2_matching',
      'step3_optimized_resume',
      'step4_interview_suggestions',
      'used_safe_fallback',
      'workflow_status',
    ])
  })

  test('reads historical generated and failed_optional interview states without generating P10 inline', () => {
    const historicalGenerated = toLegacyMvpProcessResponse(
      createHistoricalV5ResultWithInterviewPreparation()
    )
    expect(historicalGenerated.step4_interview_suggestions).toMatchObject({
      questions: expect.arrayContaining(['如何规划产品？']),
      story_recommendations: expect.arrayContaining([
        expect.objectContaining({ title: '产品交付' }),
      ]),
    })

    const historicalFailedOptional = createV5ResultFixture()
    historicalFailedOptional.deliveryDiagnostics.provenance.interview = 'failed_optional'
    expect(toLegacyMvpProcessResponse(historicalFailedOptional).step4_interview_suggestions)
      .toBeUndefined()
  })

  test('rejects every non-deliverable V5 result at the legacy API boundary', () => {
    const cases: Array<{
      name: string
      mutate: (result: V5WorkflowResult) => void
    }> = [
      { name: 'blocked decision', mutate: result => { result.deliveryDecision = 'block' } },
      { name: 'internal-only decision', mutate: result => { result.deliveryDecision = 'internal_only' } },
      { name: 'review required', mutate: result => { result.qualityGates.deliverability = 'review_required' } },
      { name: 'fact failure', mutate: result => { result.qualityGates.factSafety = 'fail' } },
      { name: 'completeness failure', mutate: result => { result.qualityGates.contentCompleteness = 'fail' } },
      { name: 'safe fallback', mutate: result => { result.usedSafeFallback = true } },
      { name: 'server renderer', mutate: result => { result.generationProvenance.artifactOrigin = 'server_renderer' } },
      { name: 'failed execution', mutate: result => { result.executionStatus = 'failed' } },
      { name: 'non-success state', mutate: result => { result.state = 'blocked_quality_validation' } },
      {
        name: 'diagnostics contradict delivery',
        mutate: result => { result.deliveryDiagnostics.outcome.disposition = 'review_required' },
      },
      { name: 'missing diagnostics', mutate: result => { delete (result as Partial<V5WorkflowResult>).deliveryDiagnostics } },
    ]

    for (const item of cases) {
      const result = structuredClone(createV5ResultFixture())
      item.mutate(result)
      try {
        toLegacyMvpProcessResponse(result)
        throw new Error(`expected ${item.name} to be rejected`)
      } catch (error) {
        expect(error).toBeInstanceOf(V5WorkflowBlockedError)
        expect(error).toMatchObject({
          code: 'V5_PRODUCT_QUALITY_BLOCKED',
          state: 'blocked_quality_validation',
        })
      }
    }
  })

  test('fails closed with a typed 422-compatible error for a malformed historical result', () => {
    const malformed = structuredClone(createV5ResultFixture()) as Partial<V5WorkflowResult>
    malformed.deliveryDecision = 'internal_only'
    delete malformed.validationIssues

    expect(() => toLegacyMvpProcessResponse(malformed as V5WorkflowResult)).toThrow(
      expect.objectContaining({
        code: 'V5_PRODUCT_QUALITY_BLOCKED',
        state: 'blocked_quality_validation',
        httpStatus: 422,
      })
    )
  })

  test('normalizes forward/reverse labels and detects order-consistent winner', async () => {
    const fixture = createV5ResultFixture()
    const left = { ...fixture.artifact, markdown: `LEFT\n${fixture.artifact.markdown}` }
    const right = { ...fixture.artifact, markdown: `RIGHT\n${fixture.artifact.markdown}` }
    const result = await runDoubleOrderBlindAb({
      runId: 'ab-fixture',
      resumeEvidenceBundle: fixture.resumeEvidenceBundle,
      jobRequirementBundle: fixture.jobRequirementBundle,
      candidateLeft: left,
      candidateRight: right,
    }, { provider: new AbProvider() })
    expect(result.normalizedForwardWinner).toBe('left')
    expect(result.normalizedReverseWinner).toBe('left')
    expect(result.absoluteGateConsistent).toBe(true)
    expect(result.orderConsistent).toBe(true)
    expect(result.outputAudits.forward.normalizationApplied).toBe(false)
    expect(result.outputAudits.forward.rawOutputDigest).toBe(result.outputAudits.forward.validatedOutputDigest)
    expect(result.outputAudits.reverse.normalizationApplied).toBe(false)
    expect(result.outputAudits.reverse.rawOutputDigest).toBe(result.outputAudits.reverse.validatedOutputDigest)
  })

  test('sends P12 a compact evidence projection without extraction bookkeeping', async () => {
    const fixture = createV5ResultFixture()
    const resume = structuredClone(fixture.resumeEvidenceBundle)
    const deliverable = resume.evidenceAtoms.find(item => item.claimType === 'deliverable')!
    deliverable.verbatimText = `张三：${deliverable.verbatimText}`
    deliverable.normalizedClaim = `张三：${deliverable.normalizedClaim}`
    deliverable.qualifiers = [...deliverable.qualifiers, '张三']
    const datedTimeline = resume.timeline[0]
    resume.timeline[0] = { ...datedTimeline, start: null, end: null }
    const excludedEvidence = {
      ...structuredClone(deliverable),
      evidenceId: 'ev_excluded_for_p12',
      status: 'excluded' as const,
    }
    resume.evidenceAtoms.push(excludedEvidence)
    resume.timeline.push({
      scopeId: 'scope_without_timeline_proof',
      kind: 'experience',
      organization: '乙公司',
      title: '产品经理',
      start: '2020',
      end: '2021',
      evidenceIds: [deliverable.evidenceId],
    })
    resume.conflicts.push({
      conflictId: 'conflict_with_partial_catalog',
      evidenceIds: [deliverable.evidenceId, excludedEvidence.evidenceId],
      description: '一侧证据已被排除',
      resolution: 'exclude_conflicting_claim',
    })
    resume.conflicts.push({
      conflictId: 'conflict_with_identity_text',
      evidenceIds: [deliverable.evidenceId],
      description: '张三的表述需要保留限定词',
      resolution: 'retain_with_qualifier',
    })
    const payloads: ReturnType<typeof parsePromptPayload>[] = []
    const provider = new class extends AbProvider {
      override async complete(input: ChatCompletionInput) {
        payloads.push(parsePromptPayload(input))
        return super.complete(input)
      }
    }()

    await runDoubleOrderBlindAb({
      runId: 'ab-compact-fixture',
      resumeEvidenceBundle: resume,
      jobRequirementBundle: fixture.jobRequirementBundle,
      candidateLeft: {
        ...fixture.artifact,
        markdown: `LEFT\n${fixture.artifact.markdown}\nmail@example.com\n138-0000-0000\nhttps://example.com/profile`,
      },
      candidateRight: {
        ...fixture.artifact,
        markdown: `RIGHT\n${fixture.artifact.markdown}\nmail@example.com\n138-0000-0000\nhttps://example.com/profile`,
      },
    }, { provider })

    expect(payloads).toHaveLength(2)
    for (const payload of payloads) {
      expect(payload.resumeEvidenceBundle).not.toHaveProperty('sections')
      expect(payload.resumeEvidenceBundle).not.toHaveProperty('unmappedFragments')
      expect(payload.resumeEvidenceBundle).not.toHaveProperty('qualityAssessment')
      expect(payload.jobRequirementBundle).not.toHaveProperty('unmappedFragments')
      expect(payload.candidates).toHaveLength(2)
      expect(payload.resumeEvidenceBundle.identity.name.value).toBeNull()
      expect(payload.resumeEvidenceBundle.identity.email.value).toBeNull()
      expect(payload.resumeEvidenceBundle.identity.phone.value).toBeNull()
      expect(payload.resumeEvidenceBundle.timeline.map(item => item.scopeId))
        .not.toContain('scope_without_timeline_proof')
      expect(payload.resumeEvidenceBundle.timeline.map(item => item.scopeId))
        .toContain(datedTimeline.scopeId)
      expect(payload.resumeEvidenceBundle.timeline.find(item => item.scopeId === datedTimeline.scopeId))
        .toMatchObject({ start: null, end: null })
      expect(payload.resumeEvidenceBundle.conflicts.map(item => item.conflictId))
        .not.toContain('conflict_with_partial_catalog')
      const projectedDeliverable = payload.resumeEvidenceBundle.evidenceAtoms.find(
        item => item.evidenceId === deliverable.evidenceId
      )
      expect(projectedDeliverable).toMatchObject({
        claimType: 'deliverable',
        numericAtoms: deliverable.numericAtoms,
      })
      expect(projectedDeliverable?.verbatimText).not.toContain('张三')
      expect(projectedDeliverable?.normalizedClaim).not.toContain('张三')
      expect(projectedDeliverable?.qualifiers).not.toContain('张三')
      expect(projectedDeliverable?.verbatimText).toContain('[姓名已隐藏]')
      expect(payload.resumeEvidenceBundle.conflicts.find(item => item.conflictId === 'conflict_with_identity_text'))
        .toMatchObject({ description: '[姓名已隐藏]的表述需要保留限定词' })
      const projectedRequirement = payload.jobRequirementBundle.requirementAtoms[0]
      expect(projectedRequirement).toMatchObject({
        verbatimText: fixture.jobRequirementBundle.requirementAtoms[0].verbatimText,
        normalizedRequirement: fixture.jobRequirementBundle.requirementAtoms[0].normalizedRequirement,
        importance: fixture.jobRequirementBundle.requirementAtoms[0].importance,
        logicGroupId: fixture.jobRequirementBundle.requirementAtoms[0].logicGroupId,
        logicOperator: fixture.jobRequirementBundle.requirementAtoms[0].logicOperator,
      })
      for (const candidate of payload.candidates) {
        expect(candidate.markdown).not.toContain('张三')
        expect(candidate.markdown).not.toContain('mail@example.com')
        expect(candidate.markdown).not.toContain('138-0000-0000')
        expect(candidate.markdown).not.toContain('https://example.com/profile')
        expect(candidate.markdown).toContain('[姓名已隐藏]')
        expect(candidate.markdown).toContain('[邮箱已隐藏]')
        expect(candidate.markdown).toContain('[电话已隐藏]')
        expect(candidate.markdown).toContain('[链接已隐藏]')
      }
    }
    expect(payloads[0].resumeEvidenceBundle).toEqual(payloads[1].resumeEvidenceBundle)
    expect(payloads[0].jobRequirementBundle).toEqual(payloads[1].jobRequirementBundle)
    expect(payloads[0].candidates[0].markdown).toBe(payloads[1].candidates[1].markdown)
    expect(payloads[0].candidates[1].markdown).toBe(payloads[1].candidates[0].markdown)
  })

  test('includes safe excluded numeric source only as non-authorizing audit context', async () => {
    const fixture = createV5ResultFixture()
    const resume = structuredClone(fixture.resumeEvidenceBundle)
    const template = resume.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
    resume.evidenceAtoms.push({ ...template, evidenceId: 'audit_1800', status: 'excluded', riskFlags: ['conflicting'], verbatimText: '张三记录访问1800次，口径有冲突。' })
    resume.evidenceAtoms.push({ ...template, evidenceId: 'private_1900', status: 'excluded', riskFlags: ['sensitive_pii'], verbatimText: '隐私地址1900。' })
    const payloads: ReturnType<typeof parsePromptPayload>[] = []
    const provider = new class extends AbProvider {
      override async complete(input: ChatCompletionInput) { payloads.push(parsePromptPayload(input)); return super.complete(input) }
    }()
    await runDoubleOrderBlindAb({ runId: 'audit-context', resumeEvidenceBundle: resume, jobRequirementBundle: fixture.jobRequirementBundle,
      candidateLeft: { ...fixture.artifact, markdown: 'LEFT\n访问1800次，1900。' }, candidateRight: { ...fixture.artifact, markdown: 'RIGHT\n参与整理。' },
    }, { provider })
    const audit = payloads[0].resumeEvidenceBundle.auditOnlyExcludedEvidence
    expect(audit).toEqual([expect.objectContaining({ evidenceId: 'audit_1800', status: 'excluded', usableForGeneration: false })])
    expect(JSON.stringify(audit)).not.toContain('张三')
    expect(JSON.stringify(audit)).not.toContain('1900')
    expect(payloads[0].resumeEvidenceBundle.auditSourceLimitations).toMatchObject({ isCompleteSource: false })
    expect(payloads[0].resumeEvidenceBundle).toEqual(payloads[1].resumeEvidenceBundle)
  })
  test('retains original JD tasks omitted by extraction in both blinded orders, without exposing contact data', async () => {
    const fixture = createV5ResultFixture(), payloads: ReturnType<typeof parsePromptPayload>[] = []
    const provider = new class extends AbProvider {
      override async complete(input: ChatCompletionInput) { payloads.push(parsePromptPayload(input)); return super.complete(input) }
    }()
    await runDoubleOrderBlindAb({ runId: 'raw-jd', resumeEvidenceBundle: fixture.resumeEvidenceBundle,
      jobRequirementBundle: fixture.jobRequirementBundle, originalJobDescription: '负责供应商质量整改。\n联系 hiring@example.com。',
      candidateLeft: { ...fixture.artifact, markdown: 'LEFT\n参与整理。' }, candidateRight: { ...fixture.artifact, markdown: 'RIGHT\n参与整理。' },
    }, { provider })
    expect(payloads).toHaveLength(2)
    expect(payloads[0].originalJob.available).toBe(true)
    expect(payloads[0].originalJob.blocks[0].text).toBe('负责供应商质量整改。')
    expect(JSON.stringify(payloads[0].originalJob)).not.toContain('hiring@example.com')
    expect(payloads[0].originalJob).toEqual(payloads[1].originalJob)
  })

  test('invalid forward citations stop offline evaluation before another paid call', async () => {
    const fixture = createV5ResultFixture()
    let calls = 0
    const provider = new class extends AbProvider {
      override async complete(input: ChatCompletionInput) {
        calls += 1
        const response = await super.complete(input)
        const value = JSON.parse(response.content)
        value.evaluations[0].unsupportedClaims = ['「并不存在的50%收入」无来源。']
        value.evaluations[0].absoluteGate = 'fail'
        value.pairwise.winner = 'B'
        return { ...response, content: JSON.stringify(value) }
      }
    }()
    await expect(runDoubleOrderBlindAb({ runId: 'bad-quote', resumeEvidenceBundle: fixture.resumeEvidenceBundle,
      jobRequirementBundle: fixture.jobRequirementBundle, candidateLeft: { ...fixture.artifact, markdown: 'LEFT\n参与整理。' },
      candidateRight: { ...fixture.artifact, markdown: 'RIGHT\n参与整理。' },
    }, { provider })).rejects.toMatchObject({ code: 'V5_JUDGE_CITATION_INVALID' })
    expect(calls).toBe(1)
  })

  test('runs the two P12 order checks sequentially', async () => {
    const fixture = createV5ResultFixture()
    const provider = new ControlledAbProvider()
    const running = runDoubleOrderBlindAb({
      runId: 'ab-sequential-fixture',
      resumeEvidenceBundle: fixture.resumeEvidenceBundle,
      jobRequirementBundle: fixture.jobRequirementBundle,
      candidateLeft: { ...fixture.artifact, markdown: `LEFT\n${fixture.artifact.markdown}` },
      candidateRight: { ...fixture.artifact, markdown: `RIGHT\n${fixture.artifact.markdown}` },
    }, { provider })

    expect(provider.calls).toBe(1)
    provider.releaseFirst()
    await running
    expect(provider.calls).toBe(2)
  })

  test('does not dispatch reverse-order P12 when the forward-order call fails', async () => {
    const fixture = createV5ResultFixture()
    let calls = 0
    const provider: LlmProvider = {
      complete: async () => {
        calls += 1
        throw new Error('forward judge failed')
      },
    }

    await expect(runDoubleOrderBlindAb({
      runId: 'ab-failure-fixture',
      resumeEvidenceBundle: fixture.resumeEvidenceBundle,
      jobRequirementBundle: fixture.jobRequirementBundle,
      candidateLeft: fixture.artifact,
      candidateRight: fixture.artifact,
    }, { provider })).rejects.toMatchObject({
      code: 'V5_PROVIDER_CALL_FAILED',
      component: 'P12',
      retryable: false,
      cause: expect.objectContaining({ message: 'forward judge failed' }),
    })
    expect(calls).toBe(1)
  })
})
