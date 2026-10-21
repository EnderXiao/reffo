import { describe, expect, test } from 'bun:test'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import { localizeTemporalRisk } from '@/v5/temporal-risk'
import { buildResumeEvidenceBundle, validateResumeExtractionCandidate } from '@/v5/evidence'
import { buildEvidencePlanningCatalog } from '@/v5/evidence-routing'
import { resumeExtractionCandidateSchema } from '@/v5/schemas'
import { materializeResumeExtractionTransport } from '@/v5/resume-extraction-transport'
import { mergeResumeExtractionCandidates } from '@/v5/chunked-resume-extraction'
import { runV5StructuredStage } from '@/v5/stage-runner'
import { buildAdaptiveStrategy } from '@/v5/adaptive-policy'
import { buildDeterministicV5ResumePlan } from '@/v5/validators'
import { buildWritingPlan } from '@/v5/writing/plan'
import { compileWritingArtifact } from '@/v5/writing/compiler'
import { V5_SCHEMA_VERSION, V5_WORKFLOW_VERSION, type ResumeExtractionCandidate } from '@/v5/types'
import { createMatchFixture, createResumeFixture } from './fixtures'

function fixture(text: string, quote?: string) {
  const fixture = createResumeFixture()
  const document = canonicalizeSourceDocument(fixture.document.blocks.map((b, i) => i === 2 ? text : b.text).join('\n')).canonicalDocument
  const candidate = structuredClone(fixture.candidate)
  candidate.factCandidates = candidate.factCandidates.map((fact, i) => ({ ...fact,
    verbatimText: document.blocks[i].text, normalizedClaim: document.blocks[i].text,
    blockRelativeSpan: { start: 0, end: document.blocks[i].text.length }, numericAtoms: [],
    ...(i === 2 ? { claimType: 'responsibility' as const, sourceActionVerb: '负责', qualifiers: [],
      riskFlags: ['future_or_planned' as const], temporalRiskQuote: quote } : {}),
  }))
  return { document, candidate }
}

describe('source-bounded temporal risk', () => {
  test.each([
    ['负责客户续约与服务交付。', '岗位调整已经批准。'],
    ['负责月度结算与凭证核对。', '预算申请经本人确认已获批准。'],
    ['参与团队实验记录与结果分析。', '课题申请于2031-04-12已获批准。'],
    ['协助门店排班与库存核查。', '转正于2021-05-03已经批准。'],
    ['已完成服务监控与告警配置。', '上线申请已经批准。'],
    ['Currently responsible for service delivery.', ' Appointment approved.'],
  ])('retains independent source duties through merged evidence, selection and Writer views: %s', (current, disputed) => {
    const { document, candidate } = fixture(current + disputed, disputed)
    candidate.factCandidates[2].proposedStatus = 'source_qualified'
    candidate.factCandidates[2].sourceActionVerb = current.startsWith('Currently') ? 'responsible' : current.slice(0, 2)
    candidate.factCandidates[2].qualifiers = current.startsWith('参与') ? ['参与', '团队'] : []
    const original = structuredClone(candidate)
    const checked = validateResumeExtractionCandidate(document, candidate)
    expect(checked.passed).toBe(true)
    const merged = mergeResumeExtractionCandidates([JSON.parse(JSON.stringify(checked.value))])
    const resume = buildResumeEvidenceBundle(document, merged)
    const catalog = buildEvidencePlanningCatalog(resume)
    const retained = resume.evidenceAtoms.find(a => a.verbatimText === current)!
    const isolated = resume.evidenceAtoms.find(a => a.verbatimText === disputed)!
    expect(retained).toBeDefined()
    expect(retained.status).toBe('source_qualified')
    expect(retained.attributionLevel).toBe(candidate.factCandidates[2].attributionLevel)
    expect(retained.qualifiers).toEqual(candidate.factCandidates[2].qualifiers)
    expect(catalog.businessAnchorEvidenceIds).toContain(retained.evidenceId)
    expect(catalog.assessments.get(isolated.evidenceId)?.allowedUses).toEqual([])
    expect(isolated.riskFlags).toContain('future_or_planned')
    expect(retained.sourceSpan.end).toBe(isolated.sourceSpan.start)
    expect(retained.sourceScopeId).toBe(isolated.sourceScopeId)
    expect(candidate).toEqual(original)

    // Matching and composition are explicitly synthetic; this is a zero-LLM
    // integration check of material flow, not a new model quality evaluation.
    const input = createMatchFixture()
    input.resume = resume
    input.job.requirementAtoms = [input.core]
    input.core.verbatimText = current; input.core.normalizedRequirement = current
    input.match.requirementMatches = [{ requirementId: input.core.requirementId, status: 'direct_match', evidenceIds: [retained.evidenceId], confidence: 'high', rationale: '合成动作匹配' }]
    input.match.positioning.primaryEvidenceIds = [retained.evidenceId]
    input.match.positioning.primaryRequirementIds = [input.core.requirementId]
    input.match.strengths = []; input.match.gaps = []
    const strategy = buildAdaptiveStrategy(input)
    const plan = buildDeterministicV5ResumePlan({ ...input, ...strategy })
    expect(plan.scopePlans.flatMap(s => s.selectedEvidenceIds)).toContain(retained.evidenceId)
    expect(plan.scopePlans.flatMap(s => s.selectedEvidenceIds)).not.toContain(isolated.evidenceId)
    const writingPlan = buildWritingPlan({ ...input, plan, policy: strategy.policy })
    expect(writingPlan.facts.map(f => f.evidenceId)).toContain(retained.evidenceId)
    expect(writingPlan.facts.map(f => f.evidenceId)).not.toContain(isolated.evidenceId)
    const composition = { contractVersion: 'p06-composition-v1', blocks: writingPlan.blueprint.slots.map(slot => ({
      slotId: slot.slotId, evidenceIds: writingPlan.coreEvidenceIdsBySlot[slot.slotId] ?? [retained.evidenceId], text: current,
    })) }
    const { artifact } = compileWritingArtifact({ ...input, plan, policy: strategy.policy, writingPlan, composition })
    expect(artifact.markdown).toContain(current)
    expect(artifact.markdown).not.toContain(disputed)
  })

  test.each(['P01', 'P01R'] as const)('%s compact transport preserves risk units through the real stage adapter', async component => {
    const { document, candidate } = fixture('负责运营流程与日常迭代。任命已经批准。', '任命已经批准。')
    candidate.factCandidates[2].proposedStatus = 'source_qualified'
    const compact = { ...candidate, factCandidates: candidate.factCandidates.map(({
      blockRelativeSpan, verbatimText, normalizedClaim, numericAtoms, ...rest
    }) => rest) }
    const original = { schemaVersion: V5_SCHEMA_VERSION, workflowVersion: V5_WORKFLOW_VERSION, runId: 'synthetic-temporal',
      payload: { canonicalSourceDocument: document } }
    let simulatedCalls = 0
    const result = await runV5StructuredStage<ResumeExtractionCandidate>({ component,
      envelope: component === 'P01' ? original : { ...original, payload: { originalEnvelope: original, currentOutput: candidate, validationIssues: [] } },
      options: { provider: { complete: async () => { simulatedCalls++; return { provider: 'mock', model: 'fixture', latencyMs: 0, content: JSON.stringify(compact), finishReason: 'stop' } } } } })
    const bundle = buildResumeEvidenceBundle(document, result.value)
    const atom = bundle.evidenceAtoms.find(a => a.verbatimText === '负责运营流程与日常迭代。')!
    expect(buildEvidencePlanningCatalog(bundle).businessAnchorEvidenceIds).toContain(atom.evidenceId)
    expect(simulatedCalls).toBe(1)
  })

  test('isolates a trailing plan without deleting current duties or promoting the plan', () => {
    const current = '负责客户工单流程设计并协同研发交付。'
    const future = '计划明年扩展至海外市场。'
    const { document, candidate } = fixture(current + future, future)
    const original = structuredClone(candidate)
    const result = validateResumeExtractionCandidate(document, candidate)
    expect(result.passed).toBe(true)
    expect(candidate).toEqual(original)
    const parts = result.value!.factCandidates.filter(f => f.sourceBlockId === 'B0003')
    expect(parts.map(f => f.verbatimText).join('')).toBe(current + future)
    expect(parts.map(f => f.proposedStatus)).toEqual(['source_qualified', 'excluded'])
    expect(parts[0].riskFlags).not.toContain('future_or_planned')
    expect(parts[1].riskFlags).toContain('future_or_planned')
    expect(parts[0].blockRelativeSpan.end).toBe(parts[1].blockRelativeSpan.start)
    expect(result.value!.timelineCandidates[0].factLocalIds).toContain(parts[1].factLocalId)
    expect(resumeExtractionCandidateSchema.safeParse(result.value).success).toBe(true)
    const again = validateResumeExtractionCandidate(document, JSON.parse(JSON.stringify(result.value)))
    expect(again.value).toEqual(result.value)
    const bundle = buildResumeEvidenceBundle(document, result.value!)
    const catalog = buildEvidencePlanningCatalog(bundle)
    const currentAtom = bundle.evidenceAtoms.find(a => a.verbatimText === current)!
    const futureAtom = bundle.evidenceAtoms.find(a => a.verbatimText === future)!
    expect(catalog.businessAnchorEvidenceIds).toContain(currentAtom.evidenceId)
    expect(catalog.businessAnchorEvidenceIds).not.toContain(futureAtom.evidenceId)
  })

  test('isolates a wrongly flagged approval without clearing its label or losing independent duties', () => {
    const approved = '任命已经批准。'
    const { document, candidate } = fixture('负责流程设计和迭代交付。' + approved, approved)
    const result = localizeTemporalRisk(document, candidate, 12)
    const parts = result.candidate.factCandidates.filter(f => f.sourceBlockId === 'B0003')
    expect(parts).toHaveLength(2)
    expect(parts[0].riskFlags).toEqual([])
    expect(parts[0].proposedStatus).toBe('source_qualified')
    expect(parts[1].verbatimText).toBe(approved)
    expect(parts[1].riskFlags).toEqual(['future_or_planned'])
    expect(parts[1].proposedStatus).toBe('excluded')
    expect(result.observations).toContainEqual({ code: 'TEMPORAL_RISK_LOCALIZED', factIndex: 2 })
    // Correct new annotations preserve the exact approval wording, not a promoted title.
    candidate.factCandidates[2].riskFlags = []
    delete candidate.factCandidates[2].temporalRiskQuote
    const checked = validateResumeExtractionCandidate(document, candidate)
    expect(checked.passed).toBe(true)
    expect(checked.value!.factCandidates[2].verbatimText).toContain(approved)
    expect(checked.value!.timelineCandidates[0].title).toBe(candidate.timelineCandidates[0].title)
  })

  test('keeps unapproved and still-planned appointment clauses isolated with their negation', () => {
    for (const risk of ['晋升尚未批准。', '任命仍待批准。', '已获批准，计划下月生效。']) {
      const { document, candidate } = fixture('负责客户流程设计和日常迭代。' + risk, risk)
      const result = validateResumeExtractionCandidate(document, candidate)
      expect(result.passed).toBe(true)
      const parts = result.value!.factCandidates.filter(f => f.sourceBlockId === 'B0003')
      expect(parts).toHaveLength(2)
      expect(parts[1].verbatimText).toBe(risk)
      expect(parts[1].proposedStatus).toBe('excluded')
    }
  })

  test('refuses missing, substring, cross-block, and duplicate risk quotes', () => {
    for (const quote of [undefined, '扩展', '尚未批准', '另一段计划扩展。']) {
      const { document, candidate } = fixture('负责项目迭代。计划扩展服务。', quote)
      expect(localizeTemporalRisk(document, candidate, 12).candidate).toEqual(candidate)
    }
    const { document, candidate } = fixture('负责项目迭代。计划扩展服务。计划扩展服务。', '计划扩展服务。')
    expect(localizeTemporalRisk(document, candidate, 12).candidate).toEqual(candidate)
  })

  test('does not detach dependent, conditional or retracted duties from their context', () => {
    for (const [text, quote] of [
      ['计划明年上任。负责相关产品研发。', '计划明年上任。'],
      ['如果获批才会负责流程设计。计划年底提交申请。', '计划年底提交申请。'],
      ['已完成平台交付。上述成果不属实，计划更正。', '上述成果不属实，计划更正。'],
      ['负责项目规划。计划扩展服务。', '计划扩展服务。'],
      ['负责平台搭建，计划明年上线。', '计划明年上线。'],
      ['职责包括：设计流程。计划扩展服务。', '计划扩展服务。'],
      ['负责平台交付。前一句只是设想。', '前一句只是设想。'],
      ['负责门店运营。这些工作尚未开展。', '这些工作尚未开展。'],
      ['负责财务核对。仅为模拟练习。', '仅为模拟练习。'],
      ['Completed service delivery. This was hypothetical.', ' This was hypothetical.'],
      ['负责流程交付，但并未开展工作。任命已经批准。', '任命已经批准。'],
      ['负责客户续约。该工作只是已批准的计划。', '该工作只是已批准的计划。'],
      ['负责财务核对。实际履职情况不详。', '实际履职情况不详。'],
    ]) {
      const { document, candidate } = fixture(text, quote)
      expect(localizeTemporalRisk(document, candidate, 12).candidate).toEqual(candidate)
    }
  })

  test('does not expand capacity, duplicate IDs, or rehabilitate other risks/excluded evidence', () => {
    const { document, candidate } = fixture('负责流程设计。计划扩展服务。', '计划扩展服务。')
    expect(localizeTemporalRisk(document, candidate, candidate.factCandidates.length).candidate).toEqual(candidate)
    const collision = structuredClone(candidate)
    collision.factCandidates[0].factLocalId = 'f3__temporal_1'
    expect(localizeTemporalRisk(document, collision, 12).candidate).toEqual(collision)
    for (const risk of ['conflicting', 'prompt_injection_like_text', 'sensitive_pii', 'uncertain'] as const) {
      const unsafe = structuredClone(candidate)
      unsafe.factCandidates[2].riskFlags.push(risk)
      expect(localizeTemporalRisk(document, unsafe, 12).candidate).toEqual(unsafe)
    }
    candidate.factCandidates[2].proposedStatus = 'excluded'
    expect(localizeTemporalRisk(document, candidate, 12).candidate).toEqual(candidate)
  })

  test('does not remove a planned-section or read-only context qualification', () => {
    const { document, candidate } = fixture('负责流程设计。计划扩展服务。', '计划扩展服务。')
    const plannedSection = structuredClone(document)
    plannedSection.blocks[2].sectionHint = '未来职责规划'
    expect(localizeTemporalRisk(plannedSection, candidate, 12).candidate).toEqual(candidate)
    const chunk = { ...document, extractionScopeContext: { serverScopeLocalId: 'work1',
      blocks: [{ ...document.blocks[1], text: '以下工作均为计划' }] } }
    expect(localizeTemporalRisk(chunk, candidate, 12).candidate).toEqual(candidate)
  })

  test('the optional temporal quote survives compact transport; legacy annotations remain valid', () => {
    const { document, candidate } = fixture('负责流程设计。计划扩展服务。', '计划扩展服务。')
    const compact = { ...candidate, factCandidates: candidate.factCandidates.map(({
      blockRelativeSpan, verbatimText, normalizedClaim, numericAtoms, ...rest
    }) => rest) }
    const result = materializeResumeExtractionTransport(compact, document)
    expect(result.success).toBe(true)
    if (!result.success) throw result.error
    expect(result.data.factCandidates[2].temporalRiskQuote).toBe('计划扩展服务。')
    delete compact.factCandidates[2].temporalRiskQuote
    expect(materializeResumeExtractionTransport(compact, document).success).toBe(true)
  })

  test('preserves decimal metrics and checks English sentence boundaries without guessing', () => {
    const chinese = fixture('已实现故障率由1.8%降至0.4%。计划扩展服务。', '计划扩展服务。')
    const result = localizeTemporalRisk(chinese.document, chinese.candidate, 12)
    expect(result.candidate.factCandidates.find(f => f.factLocalId === 'f3')?.verbatimText)
      .toBe('已实现故障率由1.8%降至0.4%。')
    const english = fixture('Currently responsible for service delivery. Planned expansion next year.', ' Planned expansion next year.')
    const split = localizeTemporalRisk(english.document, english.candidate, 12)
    expect(split.candidate.factCandidates.filter(f => f.sourceBlockId === 'B0003')).toHaveLength(2)
    const dependent = fixture('Completed delivery. This is planned for next year.', ' This is planned for next year.')
    expect(localizeTemporalRisk(dependent.document, dependent.candidate, 12).candidate).toEqual(dependent.candidate)
  })
})
