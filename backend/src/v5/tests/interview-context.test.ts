import { describe, expect, test } from 'bun:test'
import { buildInterviewContext } from '@/v5/interview-context'
import { compileV5Prompt } from '@/v5/prompt-compiler'
import { createV5ResultFixture } from '@/v5/tests/fixtures'
import { validateInterviewPreparation } from '@/v5/validators'
import type { EvidenceAtom, InterviewPreparation } from '@/v5/types'

describe('P10 evidence context', () => {
  test('keeps every usable gap and delivered-claim reference with complete original evidence and boundaries', () => {
    const result = createV5ResultFixture()
    const source = result.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
    const gapFact: EvidenceAtom = { ...source, evidenceId: 'gap-only', verbatimText: '参与调研；提升比例待确认。',
      qualifiers: ['参与', '待确认'], numericAtoms: [{ raw: '10%', valueText: '10', unit: '%', qualifier: '待确认', period: null, ownerScope: source.sourceScopeId }],
      status: 'source_qualified', riskFlags: ['uncertain', 'team_attribution', 'future_or_planned'] }
    result.resumeEvidenceBundle.evidenceAtoms.push(gapFact)
    result.matchAnalysis.gaps.push({ gapId: 'gap-local', requirementIds: [], evidenceType: 'implicit_evidence', priority: 'high',
      evidenceIds: [gapFact.evidenceId], impact: '目前只能证明参与调研。', safeHandling: '保留参与和指标待确认边界。' })
    const context = buildInterviewContext(result)
    const atom = context.resumeEvidenceBundle.evidenceAtoms.find(item => item.evidenceId === gapFact.evidenceId)!
    expect(atom.verbatimText).toBe(gapFact.verbatimText)
    expect(atom.qualifiers).toEqual(gapFact.qualifiers)
    expect(atom.numericAtoms).toEqual(gapFact.numericAtoms)
    expect(atom.riskFlags).toEqual(gapFact.riskFlags)
    expect(context.matchAnalysis.gaps.at(-1)).toEqual(result.matchAnalysis.gaps.at(-1))
    const ids = new Set(context.resumeEvidenceBundle.evidenceAtoms.map(item => item.evidenceId))
    expect(context.artifact.claims.flatMap(item => item.evidenceIds).every(id => ids.has(id))).toBe(true)
    expect(context.matchAnalysis.gaps.flatMap(item => item.evidenceIds).every(id => ids.has(id))).toBe(true)
    expect(context.artifact).not.toHaveProperty('markdown')
    expect(context.resumeEvidenceBundle).not.toHaveProperty('qualityAssessment')
    expect(context.resumeEvidenceBundle).not.toHaveProperty('identity')
    expect(atom).not.toHaveProperty('normalizedClaim')
    expect(atom).not.toHaveProperty('sourceDocumentHash')
    expect(result.artifact).toHaveProperty('markdown')
  })

  test('retains a genuine same-scope story result and its continuation instead of slicing source strings', () => {
    const result = createV5ResultFixture()
    const original = result.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
    const detail: EvidenceAtom = { ...original, evidenceId: 'story-result', claimType: 'result', verbatimText: '试运行期间流程已经上线，效果尚待复核。',
      qualifiers: ['试运行', '效果尚待复核'], sourceContinuation: { previousEvidenceId: 'story-context', separator: ' ', binding: 'server-proof' } }
    const preceding: EvidenceAtom = { ...original, evidenceId: 'story-context', claimType: 'other', verbatimText: '适用范围仅限试点团队。' }
    result.resumeEvidenceBundle.evidenceAtoms.push(detail, preceding)
    const context = buildInterviewContext(result)
    expect(context.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.evidenceId === detail.evidenceId)?.verbatimText).toBe(detail.verbatimText)
    expect(context.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.evidenceId === detail.evidenceId)?.previousEvidenceId).toBe(preceding.evidenceId)
    expect(context.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.evidenceId === preceding.evidenceId)?.verbatimText).toBe(preceding.verbatimText)
    expect(context.resumeEvidenceBundle.timeline.some(scope => scope.scopeId === detail.sourceScopeId)).toBe(true)
    const compiled = compileV5Prompt({ component: 'P10', envelope: { payload: context } })
    expect(compiled.messages[1]!.content).toContain('"previousEvidenceId":"story-context"')
  })

  test('retains every numeric continuation in a multi-block result and requires the complete cited chain', () => {
    const result = createV5ResultFixture()
    const original = result.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
    let offset = 100
    const atoms = ['结果：门店由40%提升至', '70%，员工由30%提升至', '60%；另有2025.05基线，必须保留月份口径。'].map((text, index): EvidenceAtom => {
      const start = offset; offset += text.length + 2
      return { ...original, evidenceId: `continuation-${index}`, sourceBlockId: `B${String(index + 1).padStart(4, '0')}`,
        sourceSpan: { start, end: start + text.length }, verbatimText: text, claimType: index === 0 ? 'result' : 'other',
        status: 'source_qualified', riskFlags: ['uncertain'] }
    })
    result.resumeEvidenceBundle.evidenceAtoms = atoms
    result.artifact.claims = [{ ...result.artifact.claims.find(claim => !claim.outputPath.startsWith('identity'))!, evidenceIds: [atoms[0]!.evidenceId] }]
    const context = buildInterviewContext(result)
    expect(context.resumeEvidenceBundle.evidenceAtoms.map(atom => atom.evidenceId)).toEqual(atoms.map(atom => atom.evidenceId))
    expect(context.resumeEvidenceBundle.evidenceAtoms[1]!.resultContinuationOf).toBe(atoms[0]!.evidenceId)
    expect(context.resumeEvidenceBundle.evidenceAtoms[2]!.resultContinuationOf).toBe(atoms[1]!.evidenceId)
    const preparation: InterviewPreparation = { schemaVersion: '5.0.0', questions: [], followUpQuestions: [], storyRecommendations: [{
      title: '真实目标下发案例', scopeId: original.sourceScopeId, evidenceIds: atoms.map(atom => atom.evidenceId),
      background: '核对目标下发及时率。', knownResult: '门店由40%提升至70%，员工由30%提升至60%；另有2025.05基线，必须保留月份口径。', preparationGap: null,
    }] }
    const validate = () => validateInterviewPreparation({ preparation, artifact: result.artifact, resume: result.resumeEvidenceBundle,
      job: result.jobRequirementBundle, match: result.matchAnalysis })
    expect(validate().passed).toBe(true)
    preparation.storyRecommendations[0]!.evidenceIds = [atoms[0]!.evidenceId, atoms[2]!.evidenceId]
    expect(validate().issues.map(issue => issue.code)).toContain('UNSUPPORTED_INTERVIEW_RESULT')
    preparation.storyRecommendations[0]!.evidenceIds = atoms.map(atom => atom.evidenceId)
    atoms[1]!.sourceScopeId = 'different-scope'
    expect(validate().issues.map(issue => issue.code)).toContain('UNSUPPORTED_INTERVIEW_RESULT')
  })

  test('excludes unrelated master-resume bulk while preserving requirements and sourced context IDs', () => {
    const result = createV5ResultFixture()
    const before = buildInterviewContext(result)
    const template = result.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
    for (let index = 0; index < 100; index += 1) result.resumeEvidenceBundle.evidenceAtoms.push({
      ...template, evidenceId: `unrelated-${index}`, sourceScopeId: `unselected-scope-${index}`,
      verbatimText: '不在成品与匹配引用范围的完整背景素材。'.repeat(500),
    })
    result.jobRequirementBundle.sourcedContext = [{ contextId: 'context-source', claim: '公开说明产品处于试点阶段。',
      sourceTitle: '岗位补充说明', sourceUrl: 'https://example.com/source', publishedOrRetrievedAt: '2026-09-13', confidence: 'medium' }]
    result.matchAnalysis.contextUsed = [{ contextId: 'context-source', effect: '面试时条件式确认阶段。' }]
    const context = buildInterviewContext(result)
    expect(context.resumeEvidenceBundle.evidenceAtoms).toEqual(before.resumeEvidenceBundle.evidenceAtoms)
    expect(context.jobRequirementBundle.requirementAtoms.map(atom => atom.requirementId))
      .toEqual(result.jobRequirementBundle.requirementAtoms.map(atom => atom.requirementId))
    expect(context.jobRequirementBundle.sourcedContext).toEqual(result.jobRequirementBundle.sourcedContext)
    expect(context.matchAnalysis.contextUsed).toEqual(result.matchAnalysis.contextUsed)
    expect(compileV5Prompt({ component: 'P10', envelope: { payload: context } }).estimatedInputTokens).toBeLessThan(8_000)
    expect(compileV5Prompt({ component: 'P10R', envelope: { payload: { originalEnvelope: { payload: context }, currentOutput: {}, validationIssues: [] } } }).estimatedInputTokens)
      .toBeLessThan(8_000)
  })

  test('does not leak identity, excluded or injection-like evidence through claims or matching references', () => {
    const result = createV5ResultFixture()
    const original = result.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
    const unsafe = [
      { ...original, evidenceId: 'excluded-fact', status: 'excluded' as const },
      { ...original, evidenceId: 'sensitive-fact', riskFlags: ['sensitive_pii' as const] },
      { ...original, evidenceId: 'injected-fact', riskFlags: ['prompt_injection_like_text' as const] },
    ]
    result.resumeEvidenceBundle.evidenceAtoms.push(...unsafe)
    result.matchAnalysis.gaps.push({ gapId: 'unsafe-gap', evidenceType: 'direct_missing', priority: 'high', requirementIds: [],
      evidenceIds: unsafe.map(atom => atom.evidenceId), impact: '缺少安全可引用依据', safeHandling: '保留为待确认问题' })
    const context = buildInterviewContext(result)
    expect(context.resumeEvidenceBundle.evidenceAtoms.some(atom => unsafe.some(item => item.evidenceId === atom.evidenceId))).toBe(false)
    expect(context.matchAnalysis.gaps.at(-1)?.evidenceIds).toEqual([])
    expect(context.matchAnalysis.gaps.at(-1)?.impact).toBe('缺少安全可引用依据')
  })

  test('continues validating against complete evidence and blocks invented story results', () => {
    const result = createV5ResultFixture()
    const context = buildInterviewContext(result)
    const fact = context.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
    const preparation: InterviewPreparation = { schemaVersion: '5.0.0', questions: [], followUpQuestions: [],
      storyRecommendations: [{ title: '真实项目', scopeId: fact.sourceScopeId, evidenceIds: [fact.evidenceId],
        background: fact.verbatimText, knownResult: '交付999个功能。', preparationGap: null }] }
    const validate = () => validateInterviewPreparation({ preparation, artifact: result.artifact, resume: result.resumeEvidenceBundle,
      job: result.jobRequirementBundle, match: result.matchAnalysis })
    expect(validate().issues.map(issue => issue.code)).toContain('UNSUPPORTED_INTERVIEW_RESULT')
    preparation.storyRecommendations[0]!.knownResult = null
    preparation.storyRecommendations[0]!.preparationGap = '准备真实可核验反馈。'
    expect(validate().passed).toBe(true)
  })
})
