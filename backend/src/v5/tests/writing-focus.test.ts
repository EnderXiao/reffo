import { describe, expect, test } from 'bun:test'
import { buildWritingFocus, measureWritingFocusCoverage, selectWritingProjectScopes, sourcePracticeFacets, WRITING_FOCUS_VERSION } from '@/v5/planning/writing-focus'
import { createTargetingFixture } from './targeting-fixtures'
import { projectLegacyMatch, validateJobFitMap } from '@/v5/targeting/fit'
import { buildAdaptiveStrategy } from '@/v5/adaptive-policy'
import { buildDeterministicV5ResumePlan, validateGeneratedResumeArtifact, validateV5ResumePlan } from '@/v5/validators'
import { v5ResumePlanSchema } from '@/v5/schemas'
import { createV5ResultFixture } from './fixtures'
import { buildV5DeliveryDiagnostics, assessV5DeliveryGate, isV5DeliveryDiagnostics } from '@/v5/delivery-gate'
import { sanitizeV5DeliveryDiagnostics } from '@/v5/evaluation-runner-support'

describe('writing focus planning', () => {
  test('retains independently supported task practice while compound qualifications stay unknown', () => {
    const fixture = createTargetingFixture()
    fixture.fit.links = fixture.fit.links.filter(link => link.targetId.startsWith('job:'))
    const fit = validateJobFitMap(fixture.fit, fixture.targets, fixture.resume).value!
    const match = projectLegacyMatch(fit, fixture.targets, fixture.resume, fixture.job)
    const focus = buildWritingFocus({...fixture, fit})
    const strategy = buildAdaptiveStrategy({...fixture, match})
    const plan = buildDeterministicV5ResumePlan({...fixture, match, ...strategy, writingFocus: focus})
    expect(match.requirementMatches.every(item => item.status === 'currently_unproven')).toBe(true)
    expect(plan.primaryRequirementIds).toEqual([])
    expect(plan.primaryFocusIds!.length).toBeGreaterThan(0)
    expect(plan.evidencePillars.some(pillar => pillar.focusIds?.length)).toBe(true)
    expect(v5ResumePlanSchema.safeParse(plan).success).toBe(true)
    const checked = validateV5ResumePlan({...fixture, match, ...strategy, plan, gateMode: 'relaxed_release'})
    expect(checked.issues.filter(issue => /WRITING_FOCUS|PILLAR|DIRECT_MISSING|PRIMARY_REQUIREMENT/.test(issue.code))).toEqual([])
  })

  test('does not multiply one practice across task, condition and attribute labels', () => {
    const fixture = createTargetingFixture(), focus = buildWritingFocus(fixture)
    expect(focus).toHaveLength(3)
    expect(new Set(focus.map(item => item.coverageKey)).size).toBe(1)
    const plan = {writingFocusVersion: WRITING_FOCUS_VERSION, writingFocus: focus, primaryFocusIds: focus.map(item => item.focusId)}
    expect(measureWritingFocusCoverage(plan, [])).toEqual({numerator: 0, denominator: 1})
    expect(measureWritingFocusCoverage(plan, [fixture.business.evidenceId])).toEqual({numerator: 1, denominator: 1})
    expect(measureWritingFocusCoverage({}, [])).toBeNull()
  })

  test('preserves partial practice boundaries and excludes skills and unverified numerical results', () => {
    const fixture = createTargetingFixture()
    fixture.fit.links = fixture.fit.links.map(link => ({...link, status: 'weak_signal'}))
    const focus = buildWritingFocus(fixture)
    expect(focus.every(item => item.selectionBasis === 'partial_practice' && item.limitation.length > 0)).toBe(true)
    fixture.business.claimType = 'result'
    fixture.business.riskFlags.push('uncertain')
    expect(buildWritingFocus(fixture)).toEqual([])
    fixture.business.claimType = 'skill'
    fixture.business.riskFlags = []
    expect(buildWritingFocus(fixture)).toEqual([])
  })

  test('selects distinctive evidence before trimming projects, regardless of input order', () => {
    const fixture = createTargetingFixture()
    const atoms = ['a', 'b', 'c', 'special'].map((id, index) => ({...fixture.business,
      evidenceId: `ev_${id}`, sourceScopeId: `scope_${id}`, sourceSpan: {start: index * 100, end: index * 100 + 20}}))
    const base = buildWritingFocus(fixture)[0]
    const focuses = [
      {...base, evidenceIds: atoms.slice(0, 3).map(atom => atom.evidenceId), coverageKey: 'general'},
      {...base, focusId: 'special', targetId: 'job:attribute:special', targetKind: 'attribute' as const,
        evidenceIds: [atoms[3].evidenceId], coverageKey: 'special', selectionBasis: 'partial_practice' as const},
    ]
    const select = (items: typeof atoms) => selectWritingProjectScopes({scopes: new Map(items.map(atom => [atom.sourceScopeId, [atom]])),
      focus: focuses, retainedWorkEvidenceIds: [atoms[0].evidenceId], limit: 3,
      compareAtoms: (a, b) => a.sourceSpan.start - b.sourceSpan.start})
    const result = select(atoms)
    expect([...result.scopeIds][0]).toBe('scope_special')
    expect(result.scopeIds.size).toBe(3)
    expect(result.decisions.find(item => item.scopeId === 'scope_special')?.reason).toBe('incremental_coverage')
    expect([...select([...atoms].reverse()).scopeIds]).toEqual([...result.scopeIds])
  })

  test('independent source practices sharing a task can retain separate facets', () => {
    const fixture = createTargetingFixture()
    const second = {...fixture.business, evidenceId: 'ev_distinct_design', sourceScopeId: 'scope_distinct'}
    fixture.resume.evidenceAtoms.push(second)
    fixture.fit.links.find(link => link.targetId === 'job:attribute:a1')!.evidenceIds = [second.evidenceId]
    const focus = buildWritingFocus(fixture)
    expect(new Set(focus.map(item => item.coverageKey)).size).toBe(2)
  })

  test('a shared transferable target does not hide a distinctive source practice already compared with work', () => {
    const f = createTargetingFixture(), base = buildWritingFocus(f)[0]
    const work = {...f.business, evidenceId: 'work', sourceScopeId: 'work', verbatimText: '完成用户访谈并梳理产品方案。'}
    const generic = {...f.business, evidenceId: 'generic', sourceScopeId: 'generic', verbatimText: '完成用户访谈并梳理产品方案。'}
    const distinct = {...f.business, evidenceId: 'distinct', sourceScopeId: 'distinct', verbatimText: '参与设计智能问答原型和人工复核流程。'}
    const focus = [{...base, evidenceIds: [work.evidenceId, generic.evidenceId, distinct.evidenceId], coverageKey: 'shared', priority: 'supporting' as const}]
    const selected = selectWritingProjectScopes({scopes: new Map([[generic.sourceScopeId, [generic]], [distinct.sourceScopeId, [distinct]]]),
      focus, retainedWorkEvidenceIds: [work.evidenceId], retainedWorkAtoms: [work], limit: 1,
      compareAtoms: (a, b) => a === generic ? -1 : 1})
    expect([...selected.scopeIds]).toEqual(['distinct'])
    expect(selected.decisions[0].reason).toBe('incremental_coverage')
    distinct.riskFlags = ['future_or_planned']
    expect(selectWritingProjectScopes({scopes: new Map([['generic', [generic]], ['distinct', [distinct]]]), focus,
      retainedWorkEvidenceIds: [work.evidenceId], retainedWorkAtoms: [work], limit: 1,
      compareAtoms: (a, b) => a === generic ? -1 : 1}).scopeIds.has('distinct')).toBe(false)
  })

  test('project target is soft only for incremental source facets within total budget', () => {
    const f = createTargetingFixture(), base = buildWritingFocus(f)[0]
    const generic = {...f.business, evidenceId: 'generic', sourceScopeId: 'generic', verbatimText: '参与完成产品方案。'}
    const distinct = {...f.business, evidenceId: 'distinct', sourceScopeId: 'distinct', verbatimText: '完成用户访谈。'}
    const repeat = {...distinct, evidenceId: 'repeat', sourceScopeId: 'repeat'}
    const atoms = [generic, distinct, repeat]
    const selected = selectWritingProjectScopes({scopes: new Map(atoms.map(atom => [atom.sourceScopeId, [atom]])),
      focus: atoms.map((atom,index) => ({...base, focusId: atom.evidenceId, evidenceIds: [atom.evidenceId], coverageKey: atom.evidenceId,
        priority: index === 0 ? 'core' as const : 'supporting' as const})), retainedWorkEvidenceIds: [], limit: 3, softTarget: 1,
      compareAtoms: (a, b) => atoms.indexOf(a) - atoms.indexOf(b)})
    expect([...selected.scopeIds]).toEqual(['generic', 'distinct'])
    const match = projectLegacyMatch(f.fit, f.targets, f.resume, f.job)
    const legacy = buildAdaptiveStrategy({...f, match}), revised = buildAdaptiveStrategy({...f, match, projectSelectionPolicy: 'source_facets_v1'})
    expect(legacy.policy).not.toHaveProperty('projectSelectionPolicy')
    expect(revised.policy.projectSelectionTarget).toBe(legacy.policy.hardProjectMax)
    expect(revised.policy.hardTotalListItemMax).toBe(legacy.policy.hardTotalListItemMax)
    expect(revised.policy.outputLength).toEqual(legacy.policy.outputLength)
  })

  test('behavior analysis adds research interpretation beyond instrumentation and excludes planned-only practice', () => {
    const f = createTargetingFixture(), base = buildWritingFocus(f)[0]
    const instrumentation = {...f.business, evidenceId: 'instrumentation', sourceScopeId: 'work', verbatimText: '完成埋点设计与数据看板。'}
    const research = {...f.business, evidenceId: 'research', sourceScopeId: 'research', verbatimText: '开展用户访谈、行为分析，形成使用研究和重优化方向材料。'}
    expect(sourcePracticeFacets(instrumentation)).not.toContain('behavior_analysis')
    expect(sourcePracticeFacets(research)).toContain('behavior_analysis')
    expect(sourcePracticeFacets({...research, riskFlags: ['future_or_planned']})).toEqual([])
    const selected = selectWritingProjectScopes({scopes: new Map([['research', [research]]]),
      focus: [{...base, evidenceIds: [instrumentation.evidenceId, research.evidenceId]}],
      retainedWorkEvidenceIds: [instrumentation.evidenceId], retainedWorkAtoms: [instrumentation], limit: 2, softTarget: 0,
      compareAtoms: () => 0})
    expect([...selected.scopeIds]).toEqual(['research'])
  })

  test('validates focus references instead of allowing unproven requirements to certify a pillar', () => {
    const fixture = createTargetingFixture(), match = projectLegacyMatch(fixture.fit, fixture.targets, fixture.resume, fixture.job)
    const strategy = buildAdaptiveStrategy({...fixture, match})
    const plan = buildDeterministicV5ResumePlan({...fixture, match, ...strategy, writingFocus: buildWritingFocus(fixture)})
    plan.evidencePillars.find(pillar => pillar.focusIds?.length)!.focusIds = ['missing']
    expect(validateV5ResumePlan({...fixture, match, ...strategy, plan}).issues.some(issue => issue.code === 'PILLAR_FOCUS_NOT_SUPPORTED')).toBe(true)
  })

  test('rejects a focus carrying an unverified result even if a supplied plan selected it', () => {
    const fixture = createTargetingFixture(), match = projectLegacyMatch(fixture.fit, fixture.targets, fixture.resume, fixture.job)
    const strategy = buildAdaptiveStrategy({...fixture, match})
    const plan = buildDeterministicV5ResumePlan({...fixture, match, ...strategy, writingFocus: buildWritingFocus(fixture)})
    fixture.business.claimType = 'result'
    fixture.business.riskFlags.push('uncertain')
    expect(validateV5ResumePlan({...fixture, match, ...strategy, plan}).issues.some(issue => issue.code === 'WRITING_FOCUS_INVALID')).toBe(true)
  })

  test('reports actual artifact focus coverage loss even while the qualification proof survives', () => {
    const result = createV5ResultFixture(), fixture = createTargetingFixture()
    const focuses = buildWritingFocus(fixture)
    const businessId = fixture.business.evidenceId
    Object.assign(result.resumePlan, {writingFocusVersion: WRITING_FOCUS_VERSION, writingFocus: focuses,
      primaryFocusIds: focuses.map(focus => focus.focusId), scopeSelectionDecisions: [],
      stableCoreEvidenceIds: [], primaryRequirementIds: [fixture.job.requirementAtoms[1].requirementId]})
    result.resumePlan.evidencePillars.push({pillarId: 'focus', title: '产品实践', requirementIds: [],
      focusIds: focuses.map(focus => focus.focusId), evidenceIds: [businessId], role: 'jd_primary'})
    const businessClaims = result.artifact.claims.filter(claim => claim.evidenceIds.includes(businessId))
    for (const claim of businessClaims) result.artifact.markdown = result.artifact.markdown.replace(claim.outputText, '')
    result.artifact.claims = result.artifact.claims.filter(claim => !businessClaims.includes(claim))
    const validation = validateGeneratedResumeArtifact({artifact: result.artifact, resume: result.resumeEvidenceBundle,
      plan: result.resumePlan, policy: {...result.generationPolicy, targetBusinessBulletTarget: 0, stableCoreCoverageMin: 0}})
    expect(validation.issues).toContainEqual(expect.objectContaining({code: 'PLAN_COVERAGE_REGRESSION',
      evidenceIds: expect.arrayContaining([businessId])}))
    expect(measureWritingFocusCoverage(result.resumePlan, result.artifact.claims.flatMap(claim => claim.evidenceIds)))
      .toEqual({numerator: 0, denominator: 1})
  })

  test('v3 diagnostics preserve focus coverage independently from qualification coverage', () => {
    const result = createV5ResultFixture(), fixture = createTargetingFixture()
    const focus = buildWritingFocus(fixture)
    Object.assign(result.resumePlan, {writingFocusVersion: WRITING_FOCUS_VERSION, writingFocus: focus,
      primaryFocusIds: focus.map(item => item.focusId), scopeSelectionDecisions: []})
    const diagnostics = buildV5DeliveryDiagnostics({assessment: assessV5DeliveryGate({validationPassed: true, usedSafeFallback: false, hasAdvisoryQualityIssues: false}),
      resume: result.resumeEvidenceBundle, match: result.matchAnalysis, plan: result.resumePlan, policy: result.generationPolicy,
      artifact: result.artifact, state: 'succeeded', planOrigin: 'deterministic_quality', artifactOrigin: 'server_compiler',
      usedSafeFallback: false, usedAnyFallback: false, interview: 'deferred', finalValidationIssues: [], rejectedCandidateIssues: []})
    expect(diagnostics.version).toBe('v5-delivery-diagnostics-v3')
    expect(diagnostics.metrics?.primaryWritingFocusCoverage).toEqual({numerator: 1, denominator: 1})
    expect(isV5DeliveryDiagnostics(diagnostics)).toBe(true)
    expect(sanitizeV5DeliveryDiagnostics(diagnostics)).toEqual(diagnostics)
    const missing = structuredClone(diagnostics)
    delete missing.metrics!.primaryWritingFocusCoverage
    expect(isV5DeliveryDiagnostics(missing)).toBe(false)
    expect(() => sanitizeV5DeliveryDiagnostics(missing)).toThrow()
  })
})
