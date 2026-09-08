import { describe, expect, test } from 'bun:test'
import { compileV5Prompt, schemaForV5Component } from '@/v5/prompt-compiler'
import { JOB_TARGETING_POLICY, isJobTargetedEnvelope, jobFitMapSchema, targetedJobExtractionSchema } from '@/v5/targeting/contracts'
import { buildJobTargets, validateTargetedJobExtraction } from '@/v5/targeting/profile'
import { compactTargetingResume, coreTaskEvidence, projectLegacyMatch, targetingEvidenceScores, validateJobFitMap } from '@/v5/targeting/fit'
import { createTargetingFixture } from '@/v5/tests/targeting-fixtures'
import { parseEvaluationRunnerArgs } from '@/v5/evaluation-runner-support'
import { buildAdaptiveStrategy } from '@/v5/adaptive-policy'
import { buildDeterministicV5ResumePlan } from '@/v5/validators'
import { buildWritingPlan, writingPayload } from '@/v5/writing/plan'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'

function createClaimTypeCoverageFixture(claimType: 'result' | 'deliverable') {
  const fixture = createTargetingFixture()
  const timeline = fixture.resume.timeline[0]
  const atoms = Array.from({ length: 5 }, (_, index) => {
    const text = index === 4
      ? claimType === 'result' ? '将处理时长降低20%。' : '完成需求分析报告。'
      : `负责第${index + 1}项业务的需求分析。`
    return {
      ...fixture.business,
      evidenceId: `ev_coverage_${index}`,
      sourceScopeId: `scope_coverage_${index}`,
      sourceBlockId: `B${1000 + index}`,
      sourceSpan: { start: index * 100, end: index * 100 + text.length },
      verbatimText: text,
      normalizedClaim: text,
      claimType: index === 4 ? claimType : 'action' as const,
      numericAtoms: [],
      riskFlags: [],
    }
  })
  fixture.resume.evidenceAtoms = atoms
  fixture.resume.timeline = atoms.map(atom => ({ ...timeline,
    kind: 'experience' as const, scopeId: atom.sourceScopeId, evidenceIds: [atom.evidenceId],
  }))
  const match = projectLegacyMatch({ ...fixture.fit, links: [], narratives: [] }, fixture.targets, fixture.resume, fixture.job)
  const { profile, policy } = buildAdaptiveStrategy({ resume: fixture.resume, job: fixture.job, match })
  policy.targetBusinessBulletMin = 4
  policy.targetBusinessBulletTarget = 4
  policy.targetBusinessBulletMax = 4
  policy.hardTotalListItemMax = 4
  const targetingScores = new Map(atoms.map((atom, index) => [atom.evidenceId, [100, 90, 80, 60, 70][index]]))
  const targetingTaskEvidence = new Map(atoms.slice(0, 4).map((atom, index) => [`job:task:t${index}`, [atom.evidenceId]]))
  return { input: { resume: fixture.resume, job: fixture.job, match, profile, policy }, atoms,
    targetingScores, targetingTaskEvidence }
}

describe('job-targeted internal contracts', () => {
  test('selects new contracts only from server wrappers, never from raw source or model repair output', () => {
    const envelope = { payload: { jobTargetingPolicy: JOB_TARGETING_POLICY } }
    expect(schemaForV5Component('P02', envelope)).toBe(targetedJobExtractionSchema)
    expect(schemaForV5Component('P03R', { payload: { originalEnvelope: envelope } })).toBe(jobFitMapSchema)
    expect(isJobTargetedEnvelope({ payload: { currentOutput: { jobTargetingPolicy: JOB_TARGETING_POLICY } } })).toBe(false)
    expect(isJobTargetedEnvelope({ payload: { canonicalJobDocument: { jobTargetingPolicy: JOB_TARGETING_POLICY } } })).toBe(false)
    expect(schemaForV5Component('P03', {})).not.toBe(jobFitMapSchema)
    expect(parseEvaluationRunnerArgs(['--artifact-mode', 'writer_v1', '--job-targeted'], { backendRoot: '/repo/backend' }).jobTargetingPolicy).toBe(JOB_TARGETING_POLICY)
    expect(() => parseEvaluationRunnerArgs(['--job-targeted'], { backendRoot: '/repo/backend' })).toThrow()
  })
  test('keeps existing P02/P03 budgets and source-fact namespaces separate', () => {
    const fixture = createTargetingFixture()
    for (const component of ['P02', 'P02R', 'P03', 'P03R'] as const) {
      const prompt = compileV5Prompt({ component, envelope: { payload: { jobTargetingPolicy: JOB_TARGETING_POLICY } } })
      expect(prompt.maxOutputTokens).toBe(component.startsWith('P02') ? 7200 : 6000)
    }
    expect(targetedJobExtractionSchema.safeParse(fixture.candidate).success).toBe(true)
    expect(validateTargetedJobExtraction(fixture.document, fixture.candidate).passed).toBe(true)
    expect(fixture.targets.every(target => target.id.startsWith('job:') || target.id.startsWith('req_'))).toBe(true)
    expect(compactTargetingResume(fixture.resume)).not.toHaveProperty('identity')
  })
  test.each(['unknown_source', 'duplicate_id', 'missing_reason', 'invented_metric', 'unknown_link', 'unsupported_number'] as const)('rejects concrete profile error %s', mutation => {
    const fixture = createTargetingFixture(), profile = fixture.candidate.jobSuccessProfile
    if (mutation === 'unknown_source') profile.tasks[0].provenance.sourceBlockIds = ['fake']
    if (mutation === 'duplicate_id') profile.tasks.push(structuredClone(profile.tasks[0]))
    if (mutation === 'missing_reason') profile.successConditions[0].provenance.reason = ''
    if (mutation === 'invented_metric') profile.outcomes.push({ id: 'job:outcome:o1', text: '收入增长', taskIds: ['job:task:t1'], metricQuote: '增长50%', provenance: profile.tasks[0].provenance })
    if (mutation === 'unknown_link') profile.attributes[0].conditionIds = ['job:condition:missing']
    if (mutation === 'unsupported_number') profile.tasks[0].text = '提高收入50%'
    expect(validateTargetedJobExtraction(fixture.document, fixture.candidate).passed).toBe(false)
  })
  test('does not require six attributes, metrics or willingness to produce a usable profile', () => {
    const fixture = createTargetingFixture()
    fixture.candidate.jobSuccessProfile.attributes = []
    fixture.candidate.jobSuccessProfile.outcomes = []
    fixture.candidate.jobSuccessProfile.unknowns.push('出差与任职动机未说明。')
    expect(validateTargetedJobExtraction(fixture.document, fixture.candidate).passed).toBe(true)
  })
  test('unclear qualification is locally downgraded, not turned into a model repair', () => {
    const fixture = createTargetingFixture()
    fixture.candidate.jobSuccessProfile.requirements[0].sourceQuote = '熟练使用SQL'
    const checked = validateTargetedJobExtraction(fixture.document, fixture.candidate)
    expect(checked.passed).toBe(true)
    expect(checked.value!.jobSuccessProfile.requirements[0].condition).toBe('unclear')
    expect(checked.value!.requirementCandidates[1].importance).not.toBe('must_have')
  })
  test('omitted judgments become unknown without certifying a qualification', () => {
    const fixture = createTargetingFixture()
    fixture.fit.links = fixture.fit.links.filter(link => link.targetId.startsWith('job:'))
    const checked = validateJobFitMap(fixture.fit, fixture.targets, fixture.resume)
    expect(checked.passed).toBe(true)
    const match = projectLegacyMatch(checked.value!, fixture.targets, fixture.resume, fixture.job)
    expect(match.requirementMatches.every(item => item.status === 'currently_unproven')).toBe(true)
  })
  test.each(['jd_as_evidence', 'missing_proof', 'missing_difference', 'duplicate_target'] as const)('rejects concrete mapping error %s', mutation => {
    const fixture = createTargetingFixture()
    if (mutation === 'jd_as_evidence') fixture.fit.links[0].evidenceIds = [fixture.targets[0].id]
    if (mutation === 'missing_proof') fixture.fit.links[0].evidenceIds = []
    if (mutation === 'missing_difference') fixture.fit.links[0].difference = ''
    if (mutation === 'duplicate_target') fixture.fit.links.push(structuredClone(fixture.fit.links[0]))
    expect(validateJobFitMap(fixture.fit, fixture.targets, fixture.resume).passed).toBe(false)
  })
  test('drops an unsupported optional narrative without repairing valid matching links', () => {
    const fixture = createTargetingFixture()
    fixture.fit.narratives[0].evidenceIds = [fixture.skill.evidenceId]
    const checked = validateJobFitMap(fixture.fit, fixture.targets, fixture.resume)
    expect(checked.passed).toBe(true)
    expect(checked.value!.narratives).toEqual([])
    expect(checked.value!.links).toEqual(fixture.fit.links)
  })
  test('weak signals and explicit gaps remain distinct internally and compatible publicly', () => {
    const fixture = createTargetingFixture()
    const requirement = fixture.fit.links.find(link => link.targetId.startsWith('req_'))!
    for (const status of ['weak_signal', 'explicit_gap'] as const) {
      requirement.status = status
      const checked = validateJobFitMap(fixture.fit, fixture.targets, fixture.resume)
      expect(checked.passed).toBe(true)
      const projected = projectLegacyMatch(checked.value!, fixture.targets, fixture.resume, fixture.job)
      expect(projected.requirementMatches.find(item => item.requirementId === requirement.targetId)).toMatchObject({ status: 'currently_unproven', evidenceIds: [] })
    }
  })
  test('attribute multiplicity cannot inflate evidence rank', () => {
    const fixture = createTargetingFixture()
    const original = targetingEvidenceScores(fixture.fit, fixture.targets, fixture.resume)
    fixture.targets.push({ ...fixture.targets[0], id: 'job:task:duplicate' })
    fixture.fit.links.push({ ...fixture.fit.links[0], targetId: 'job:task:duplicate' })
    expect(targetingEvidenceScores(fixture.fit, fixture.targets, fixture.resume)).toEqual(original)
  })
  test('attributes cannot upgrade an optional or unclear parent task to supporting priority', () => {
    const fixture = createTargetingFixture()
    for (const priority of ['optional', 'unclear'] as const) {
      fixture.candidate.jobSuccessProfile.tasks[0].priority = priority
      const targets = buildJobTargets(fixture.candidate, fixture.job)
      expect(targets.filter(target => ['condition', 'attribute'].includes(target.kind)).every(target => target.priority === priority)).toBe(true)
    }
  })
  test('server downgrade removes an overstated narrative without causing a repair call', () => {
    const fixture = createTargetingFixture()
    fixture.fit.links[0] = { ...fixture.fit.links[0], status: 'direct', evidenceIds: [fixture.skill.evidenceId] }
    fixture.fit.narratives[0].evidenceIds = [fixture.skill.evidenceId]
    const checked = validateJobFitMap(fixture.fit, fixture.targets, fixture.resume)
    expect(checked.passed).toBe(true)
    expect(checked.value!.links[0].status).toBe('weak_signal')
    expect(checked.value!.narratives).toEqual([])
    expect(checked.issues.some(issue => issue.code === 'JOB_FIT_NARRATIVE_DOWNGRADED')).toBe(true)
    expect(fixture.fit.narratives).toHaveLength(1)
  })
  test.each(['weak_signal', 'unknown', 'explicit_gap', 'conflicted'] as const)('native %s cannot turn an optional narrative into a repair loop', status => {
    const fixture = createTargetingFixture()
    fixture.fit.links[0].status = status
    const before = structuredClone(fixture.fit)
    const checked = validateJobFitMap(fixture.fit, fixture.targets, fixture.resume)
    expect(checked.passed).toBe(true)
    expect(checked.value!.narratives).toEqual([])
    expect(checked.value!.links[0].status).toBe(status)
    expect(checked.issues.map(issue => issue.code)).toContain('JOB_FIT_NARRATIVE_DOWNGRADED')
    expect(fixture.fit).toEqual(before)
  })
  test('a supported target cannot conceal another weak target in the same narrative', () => {
    const fixture = createTargetingFixture()
    fixture.fit.links[1].status = 'weak_signal'
    fixture.fit.narratives[0].targetIds.push(fixture.fit.links[1].targetId)
    expect(validateJobFitMap(fixture.fit, fixture.targets, fixture.resume).value!.narratives).toEqual([])
  })
  test.each(['fake_target', 'fake_evidence', 'unlinked_evidence', 'jd_evidence'] as const)('discards an invalid optional narrative without retrying matching: %s', mutation => {
    const fixture = createTargetingFixture()
    fixture.fit.links[0].status = 'weak_signal'
    if (mutation === 'fake_target') fixture.fit.narratives[0].targetIds = ['job:task:fake']
    else fixture.fit.narratives[0].evidenceIds = [mutation === 'fake_evidence' ? 'ev_fake'
      : mutation === 'jd_evidence' ? fixture.targets[0].id : fixture.skill.evidenceId]
    const checked = validateJobFitMap(fixture.fit, fixture.targets, fixture.resume)
    expect(checked.passed).toBe(true)
    expect(checked.value!.narratives).toEqual([])
    expect(checked.issues.map(issue => issue.code)).toContain('JOB_FIT_NARRATIVE_UNSUPPORTED')
  })
  test('partial practice retains selection value without certifying the compound qualification', () => {
    const fixture = createTargetingFixture()
    fixture.fit.links.forEach(link => { link.status = 'weak_signal' })
    const before = structuredClone(fixture.resume)
    const checked = validateJobFitMap(fixture.fit, fixture.targets, fixture.resume)
    expect(checked.passed).toBe(true)
    const fit = checked.value!
    const scores = targetingEvidenceScores(fit, fixture.targets, fixture.resume)
    expect(scores.get(fixture.business.evidenceId)).toBeGreaterThan(0)
    expect(scores.has(fixture.skill.evidenceId)).toBe(false)
    expect(coreTaskEvidence(fit, fixture.targets, fixture.resume).get('job:task:t1')).toEqual([fixture.business.evidenceId])
    const match = projectLegacyMatch(fit, fixture.targets, fixture.resume, fixture.job)
    expect(match.requirementMatches.every(item => item.status === 'currently_unproven' && item.evidenceIds.length === 0)).toBe(true)
    const { profile, policy } = buildAdaptiveStrategy({ resume: fixture.resume, job: fixture.job, match })
    const plan = buildDeterministicV5ResumePlan({ resume: fixture.resume, job: fixture.job, match, profile, policy,
      targetingScores: scores, targetingTaskEvidence: coreTaskEvidence(fit, fixture.targets, fixture.resume) })
    expect(plan.scopePlans.flatMap(scope => scope.selectedEvidenceIds)).toContain(fixture.business.evidenceId)
    const payload = writingPayload(buildWritingPlan({ resume: fixture.resume, job: fixture.job, match, policy, plan,
      targeting: { profile: fixture.candidate.jobSuccessProfile, targets: fixture.targets, fit } }))
    expect(payload.jobTargeting!.links.find(link => link.targetId === 'job:task:t1')).toMatchObject({ status: 'weak_signal', evidenceIds: [fixture.business.evidenceId] })
    expect(payload.jobTargeting!.narrativeIntents).toEqual([])
    expect(fixture.resume).toEqual(before)
  })
  test.each(['skill', 'self_praise', 'excluded', 'conflicting', 'no_difference', 'no_similarity', 'unknown_target', 'unknown', 'explicit_gap', 'conflicted'] as const)('does not reserve a task slot for non-practice or unsafe evidence: %s', mutation => {
    const fixture = createTargetingFixture()
    fixture.fit.links = [fixture.fit.links[0]]
    const link = fixture.fit.links[0]
    link.status = 'weak_signal'
    if (mutation === 'skill') link.evidenceIds = [fixture.skill.evidenceId]
    if (mutation === 'self_praise') fixture.business.riskFlags.push('self_assessment_only')
    if (mutation === 'excluded') fixture.business.status = 'excluded'
    if (mutation === 'conflicting') fixture.business.riskFlags.push('conflicting')
    if (mutation === 'no_difference') link.difference = ''
    if (mutation === 'no_similarity') link.similarity = ''
    if (mutation === 'unknown_target') fixture.targets[0].basis = 'unknown'
    if (['unknown', 'explicit_gap', 'conflicted'].includes(mutation)) link.status = mutation as 'unknown' | 'explicit_gap' | 'conflicted'
    expect(coreTaskEvidence(fixture.fit, fixture.targets, fixture.resume).size).toBe(0)
    expect(targetingEvidenceScores(fixture.fit, fixture.targets, fixture.resume).size).toBe(0)
  })
  test('unknown job assumptions remain unknown even when the model tries to certify them', () => {
    const fixture = createTargetingFixture()
    fixture.targets[0].basis = 'unknown'
    fixture.fit.links[0] = { ...fixture.fit.links[0], status: 'direct', evidenceIds: [] }
    fixture.fit.narratives = []
    const checked = validateJobFitMap(fixture.fit, fixture.targets, fixture.resume)
    expect(checked.passed).toBe(true)
    expect(checked.value!.links[0]).toMatchObject({ status: 'unknown', evidenceIds: [] })
  })
  test('changed task relevance changes rank, without mutating evidence', () => {
    const fixture = createTargetingFixture(), before = structuredClone(fixture.resume)
    const first = targetingEvidenceScores(fixture.fit, fixture.targets, fixture.resume)
    fixture.fit.links = fixture.fit.links.map(link => ({ ...link, evidenceIds: [fixture.skill.evidenceId] }))
    const second = targetingEvidenceScores(fixture.fit, fixture.targets, fixture.resume)
    expect(first.get(fixture.business.evidenceId)).toBeGreaterThan(first.get(fixture.skill.evidenceId) ?? 0)
    expect(second.get(fixture.skill.evidenceId)).toBeGreaterThan(second.get(fixture.business.evidenceId) ?? 0)
    expect(fixture.resume).toEqual(before)
  })
  test('Writer receives task links and only selected facts, not an extra stage', () => {
    const fixture = createTargetingFixture()
    const match = projectLegacyMatch(fixture.fit, fixture.targets, fixture.resume, fixture.job)
    const { profile, policy } = buildAdaptiveStrategy({ resume: fixture.resume, job: fixture.job, match })
    const targeting = { profile: fixture.candidate.jobSuccessProfile, targets: fixture.targets, fit: fixture.fit }
    const plan = buildDeterministicV5ResumePlan({ resume: fixture.resume, job: fixture.job, match, profile, policy, targetingScores: targetingEvidenceScores(fixture.fit, fixture.targets, fixture.resume) })
    const payload = writingPayload(buildWritingPlan({ resume: fixture.resume, job: fixture.job, match, policy, plan, targeting }))
    expect(payload.jobTargeting?.tasks[0].id).toBe('job:task:t1')
    expect(payload.blueprint.slots.flatMap(slot => slot.facts ?? []).every(fact => !fact.evidenceId.startsWith('job:'))).toBe(true)
    expect(payload.factPlacement).toBe('slot-local-v1')
    expect(payload).not.toHaveProperty('facts')
    for (const slot of payload.blueprint.slots) {
      expect(slot.facts?.map(fact => fact.evidenceId).sort()).toEqual([...slot.allowedEvidenceIds].sort())
    }
    expect(payload).not.toHaveProperty('resumeEvidenceBundle')
    expect(payload.jobTargeting).not.toHaveProperty('narratives')
    expect(payload.positioning).not.toContain(fixture.fit.narratives[0].statement)
    expect(payload.jobTargeting?.links.every(link => !('similarity' in link) && !('expressionAngle' in link))).toBe(true)
  })
  test('normalizes a role range with a missing unit without certifying a year threshold', () => {
    const fixture = createTargetingFixture()
    const document = canonicalizeSourceDocument('产品经理\n要求2-3产品经理及1年以上AI工作经验\n要求熟练使用SQL', 'unit-test').canonicalDocument
    fixture.candidate.basicInfo.title = '产品经理'
    fixture.candidate.requirementCandidates.forEach((item, index) => {
      const block = document.blocks[index + 1]
      item.verbatimText = block.text
      item.normalizedRequirement = block.text
      item.blockRelativeSpan = { start: 0, end: block.text.length }
    })
    const attribute = fixture.candidate.jobSuccessProfile.attributes[0]
    attribute.text = '2-3年产品经理及1年以上AI工作经验'
    attribute.provenance = { basis: 'explicit', sourceBlockIds: ['B0002'], reason: '', confidence: 'high' }
    fixture.candidate.jobSuccessProfile.requirements.push({ requirementLocalId: 'r1', condition: 'necessary', sourceQuote: document.blocks[1].text })
    const before = structuredClone(fixture.candidate)
    const checked = validateTargetedJobExtraction(document, fixture.candidate)
    expect(checked.passed).toBe(true)
    expect(checked.value!.jobSuccessProfile.attributes[0].text).toContain('2-3（单位未明）')
    expect(checked.value!.jobSuccessProfile.attributes[0].provenance.basis).toBe('inferred')
    expect(checked.value!.jobSuccessProfile.requirements.find(item => item.requirementLocalId === 'r1')?.condition).toBe('unclear')
    expect(fixture.candidate).toEqual(before)
    attribute.text = '2-5年产品经理经验'
    expect(validateTargetedJobExtraction(document, fixture.candidate).passed).toBe(false)
  })
  test('partial compound proof is locally downgraded while independent supported tasks survive', () => {
    const fixture = createTargetingFixture()
    fixture.targets[0].text = '负责方案评审、模型效果评估及开发迭代'
    fixture.fit.links[0].status = 'direct'
    fixture.fit.links[0].difference = '无'
    const checked = validateJobFitMap(fixture.fit, fixture.targets, fixture.resume)
    expect(checked.passed).toBe(true)
    expect(checked.value!.links[0].status).toBe('weak_signal')
    expect(checked.value!.links[0].difference).toContain('模型效果评估')
    expect(checked.value!.links[1].status).toBe('transferable')
    expect(coreTaskEvidence(checked.value!, fixture.targets, fixture.resume).get('job:task:t1')).toEqual([fixture.business.evidenceId])
    fixture.business.verbatimText = '参与模型效果评估和方案评审、开发迭代。'
    expect(validateJobFitMap(fixture.fit, fixture.targets, fixture.resume).value!.links[0].status).toBe('direct')
  })
  test('known unsupported narrative responsibilities do not trigger model repair', () => {
    const fixture = createTargetingFixture()
    fixture.fit.narratives[0].statement = '独立完成方案，协同研发、市场、运营推进。'
    const checked = validateJobFitMap(fixture.fit, fixture.targets, fixture.resume)
    expect(checked.passed).toBe(true)
    expect(checked.value!.narratives).toEqual([])
    expect(checked.value!.links).toEqual(fixture.fit.links)
    expect(checked.issues.map(issue => issue.code)).toContain('JOB_FIT_NARRATIVE_FACT_RISK')
  })
  test('targeted planning reserves depth for relevant work instead of round-robin unrelated scopes', () => {
    const fixture = createTargetingFixture()
    const originalScope = fixture.business.sourceScopeId
    for (let index = 0; index < 3; index += 1) {
      const scopeId = index === 0 ? originalScope : `scope_other_${index}`
      const fact = { ...fixture.business, evidenceId: `ev_depth_${index}`, sourceScopeId: scopeId,
        sourceBlockId: `B010${index}`, sourceSpan: { start: 1000 + index * 100, end: 1014 + index * 100 }, verbatimText: '参与团队交付功能。' }
      fixture.resume.evidenceAtoms.push(fact)
      if (index > 0) fixture.resume.timeline.push({ ...fixture.resume.timeline[0], scopeId, evidenceIds: [fact.evidenceId] })
    }
    const match = projectLegacyMatch(fixture.fit, fixture.targets, fixture.resume, fixture.job)
    const { profile, policy } = buildAdaptiveStrategy({ resume: fixture.resume, job: fixture.job, match })
    policy.targetBusinessBulletMin = 1; policy.targetBusinessBulletTarget = 3; policy.hardTotalListItemMax = 10
    const input = { resume: fixture.resume, job: fixture.job, match, profile, policy }
    const before = structuredClone(fixture.resume)
    const legacy = buildDeterministicV5ResumePlan(input)
    const scores = new Map([[fixture.business.evidenceId, 100], ['ev_depth_0', 99], ['ev_depth_1', 1], ['ev_depth_2', 1]])
    const targeted = buildDeterministicV5ResumePlan({ ...input, targetingScores: scores,
      targetingTaskEvidence: new Map([['job:task:core', [fixture.business.evidenceId, 'ev_depth_0']]]) })
    expect(legacy.scopePlans.find(scope => scope.scopeId === originalScope)!.bulletBudget).toBe(1)
    expect(targeted.scopePlans.find(scope => scope.scopeId === originalScope)!.bulletBudget).toBe(2)
    expect(targeted.scopePlans.reduce((sum, scope) => sum + scope.bulletBudget, 0)).toBe(3)
    expect(fixture.resume).toEqual(before)
  })
  test.each(['result', 'deliverable'] as const)('type diversity cannot remove the last selected proof of a core task: %s', claimType => {
    const fixture = createClaimTypeCoverageFixture(claimType)
    fixture.targetingTaskEvidence.set('job:task:unproven', ['ev_missing'])
    const before = structuredClone(fixture.input.resume)
    const plan = buildDeterministicV5ResumePlan({ ...fixture.input,
      targetingScores: fixture.targetingScores, targetingTaskEvidence: fixture.targetingTaskEvidence })
    const selected = plan.scopePlans.flatMap(scope => scope.selectedEvidenceIds)
    expect(selected.toSorted()).toEqual(fixture.atoms.slice(0, 4).map(atom => atom.evidenceId).toSorted())
    expect(selected).not.toContain(fixture.atoms[4].evidenceId)
    expect(plan.scopePlans.reduce((sum, scope) => sum + scope.bulletBudget, 0)).toBe(4)
    expect(fixture.input.resume).toEqual(before)
  })
  test('type diversity may replace a core proof when its replacement covers the same task', () => {
    const fixture = createClaimTypeCoverageFixture('result')
    fixture.targetingTaskEvidence.get('job:task:t2')!.push(fixture.atoms[4].evidenceId)
    const plan = buildDeterministicV5ResumePlan({ ...fixture.input,
      targetingScores: fixture.targetingScores, targetingTaskEvidence: fixture.targetingTaskEvidence })
    const selected = plan.scopePlans.flatMap(scope => scope.selectedEvidenceIds)
    expect(selected).toContain(fixture.atoms[4].evidenceId)
    expect(selected).not.toContain(fixture.atoms[2].evidenceId)
    for (const ids of fixture.targetingTaskEvidence.values()) expect(ids.some(id => selected.includes(id))).toBe(true)
  })
  test('a replacement must preserve every core task supported by the removed proof', () => {
    const fixture = createClaimTypeCoverageFixture('deliverable')
    fixture.targetingTaskEvidence.get('job:task:t2')!.push(fixture.atoms[4].evidenceId)
    fixture.targetingTaskEvidence.set('job:task:additional', [fixture.atoms[2].evidenceId])
    const plan = buildDeterministicV5ResumePlan({ ...fixture.input,
      targetingScores: fixture.targetingScores, targetingTaskEvidence: fixture.targetingTaskEvidence })
    const selected = plan.scopePlans.flatMap(scope => scope.selectedEvidenceIds)
    expect(selected.toSorted()).toEqual(fixture.atoms.slice(0, 4).map(atom => atom.evidenceId).toSorted())
  })
  test('legacy type diversity selection remains unchanged without targeted scoring', () => {
    const fixture = createClaimTypeCoverageFixture('result')
    const legacy = buildDeterministicV5ResumePlan(fixture.input)
    const withoutTargetedScores = buildDeterministicV5ResumePlan({ ...fixture.input,
      targetingTaskEvidence: fixture.targetingTaskEvidence })
    const selected = (plan: ReturnType<typeof buildDeterministicV5ResumePlan>) => plan.scopePlans
      .flatMap(scope => scope.selectedEvidenceIds).toSorted()
    expect(selected(legacy)).toContain(fixture.atoms[4].evidenceId)
    expect(selected(withoutTargetedScores)).toEqual(selected(legacy))
  })
})
