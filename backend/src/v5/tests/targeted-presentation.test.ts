import { describe, expect, test } from 'bun:test'
import { projectLegacyMatch, validateJobFitMap } from '@/v5/targeting/fit'
import { createTargetingFixture } from '@/v5/tests/targeting-fixtures'
import { toMatchAnalysis } from '@/v5/main/compatibility'
import { calculateV5MatchScore } from '@/v5/match-score'

describe('targeted gap and strategy presentation', () => {
  test('preserves specific differences and writing angles without depending on optional questions', () => {
    const f = createTargetingFixture()
    f.fit.questions = []
    const task = f.fit.links.find(link => link.targetId === 'job:task:t1')!
    task.status = 'weak_signal'
    task.difference = '已有产品方案交付，尚未提供独立负责产品规划的材料。'
    task.expressionAngle = '前置本人参与的需求拆解与方案交付，保留参与角色，不写成独立负责。'
    const match = projectLegacyMatch(f.fit, f.targets, f.resume, f.job)
    const result = toMatchAnalysis({ resumeEvidenceBundle: f.resume, jobRequirementBundle: f.job,
      matchAnalysis: match, matchScore: calculateV5MatchScore({ job: f.job, match, resume: f.resume }) })
    expect(result.weaknesses.some(text => text.includes(task.difference))).toBe(true)
    expect(result.weakness_details?.find(gap => gap.weakness.includes(task.difference))).toMatchObject({
      evidence_type: 'implicit_evidence', priority: 'high', evidence: f.business.verbatimText,
      suggestion: task.expressionAngle,
    })
    expect(result.optimization_suggestions).toContain(task.expressionAngle)
    expect(result.weaknesses).not.toContain('当前证据不足，不能据此判定本人不具备能力。')
  })

  test('follow-up questions never replace optimization strategies or create a gap for direct matches', () => {
    const f = createTargetingFixture()
    f.fit.links.forEach(link => { link.status = 'direct' })
    f.fit.questions = [{ targetId: 'job:task:t1', question: '是否还有更多材料？' }]
    const match = projectLegacyMatch(f.fit, f.targets, f.resume, f.job)
    expect(match.gaps).toEqual([])
  })

  test('deduplicates task and requirement views of the same gap and keeps absent evidence distinct', () => {
    const f = createTargetingFixture()
    f.fit.links.forEach(link => { link.status = 'unknown'; link.evidenceIds = []; link.expressionAngle = '' })
    const match = projectLegacyMatch(f.fit, f.targets, f.resume, f.job)
    const ids = match.gaps.flatMap(gap => gap.requirementIds)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(ids).size).toBe(f.job.requirementAtoms.length)
    expect(match.gaps.every(gap => gap.evidenceType === 'direct_missing' && gap.evidenceIds.length === 0)).toBe(true)
    expect(match.gaps.every(gap => gap.safeHandling.includes('没有实际经历时'))).toBe(true)
  })

  test('explicit differences and conflicting materials have different handling', () => {
    const f = createTargetingFixture()
    f.fit.links.forEach(link => { link.status = 'explicit_gap' })
    let match = projectLegacyMatch(f.fit, f.targets, f.resume, f.job)
    expect(match.gaps[0].safeHandling).toContain('如实保留')
    f.fit.links.forEach(link => { link.status = 'conflicted' })
    match = projectLegacyMatch(f.fit, f.targets, f.resume, f.job)
    expect(match.gaps[0].safeHandling).toContain('先核对')
  })

  test('keeps distinct task gaps even when they share one compound requirement', () => {
    const f = createTargetingFixture()
    const task = f.targets.find(target => target.kind === 'task')!
    f.targets.push({...task, id: 'job:task:other', text: '数据复盘'})
    f.fit.links.push({...f.fit.links.find(link => link.targetId === task.id)!,
      targetId: 'job:task:other', difference: '没有数据复盘材料。', expressionAngle: '补充数据复盘的真实证据。'})
    const match = projectLegacyMatch(f.fit, f.targets, f.resume, f.job)
    expect(match.gaps.some(gap => gap.gapId === `target_gap_${task.id}`)).toBe(true)
    expect(match.gaps.some(gap => gap.gapId === 'target_gap_job:task:other')).toBe(true)
  })

  test('prefers retained task gaps even when the shared requirement has higher priority', () => {
    const f = createTargetingFixture()
    const task = f.targets.find(target => target.kind === 'task')!
    task.priority = 'supporting'
    const requirement = f.targets.find(target => target.kind === 'requirement' && task.requirementIds.includes(target.id))!
    requirement.priority = 'core'
    f.targets.push({ ...task, id: 'job:task:other', text: '数据复盘', taskIds: ['job:task:other'] })
    f.fit.links.push({ ...f.fit.links.find(link => link.targetId === task.id)!,
      targetId: 'job:task:other', difference: '没有数据复盘材料。', expressionAngle: '补充数据复盘的真实证据。' })
    const match = projectLegacyMatch(f.fit, f.targets, f.resume, f.job)
    expect(match.gaps.filter(gap => gap.requirementIds.includes(requirement.id)).map(gap => gap.gapId))
      .toEqual([`target_gap_${task.id}`, 'target_gap_job:task:other'])
  })

  test('does not suppress a requirement gap when its task gap cannot survive validation', () => {
    const f = createTargetingFixture()
    const task = f.targets.find(target => target.kind === 'task')!
    const taskLink = f.fit.links.find(link => link.targetId === task.id)!
    taskLink.status = 'unknown'
    taskLink.evidenceIds = []
    f.fit.narratives = []
    const match = projectLegacyMatch(f.fit, f.targets, f.resume, f.job)
    expect(match.gaps.some(gap => gap.gapId === `target_gap_${task.id}`)).toBe(false)
    expect(match.gaps.some(gap => gap.gapId === `target_gap_${task.requirementIds[0]}`)).toBe(true)
  })

  test('retains excluded conflict evidence for review without making it a writing fact', () => {
    const f = createTargetingFixture()
    f.business.status = 'excluded'
    f.fit.narratives = []
    f.fit.links.forEach(link => { link.status = 'conflicted'; link.evidenceIds = [f.business.evidenceId] })
    const match = projectLegacyMatch(f.fit, f.targets, f.resume, f.job)
    expect(match.gaps.length).toBeGreaterThan(0)
    expect(match.gaps[0].safeHandling).toContain('先核对')
    expect(match.gaps[0].evidenceIds).toContain(f.business.evidenceId)
    expect(f.business.status).toBe('excluded')
    expect(match.requirementMatches.every(item => item.evidenceIds.length === 0)).toBe(true)
  })

  test.each(['unknown', 'weak_signal', 'transferable'] as const)('bounds unsupported ability denials and ownership advice for %s', status => {
    const f = createTargetingFixture()
    f.fit.narratives = []
    f.fit.links.forEach(link => {
      link.status = status
      if (status === 'unknown') link.evidenceIds = []
      link.difference = '候选人不具备产品规划能力。'
      link.expressionAngle = '突出独立负责产品规划。'
    })
    const before = structuredClone(f.fit)
    const checked = validateJobFitMap(f.fit, f.targets, f.resume)
    expect(checked.passed).toBe(true)
    expect(checked.value!.links[0].difference).toContain('当前材料尚未充分证明')
    expect(checked.value!.links[0].expressionAngle).toBe('')
    const match = projectLegacyMatch(f.fit, f.targets, f.resume, f.job)
    expect(match.gaps.length).toBeGreaterThan(0)
    expect(match.gaps.every(gap => !gap.impact.includes('候选人不具备产品规划能力'))).toBe(true)
    expect(match.gaps.every(gap => !gap.safeHandling.includes('突出独立负责'))).toBe(true)
    expect(f.fit).toEqual(before)
  })

  test.each([
    '未提供独立产品规划的材料。',
    '当前材料缺乏产品规划能力的证据。',
    '不能据此断言候选人不具备产品规划能力。',
    '未证明候选人不会做产品规划。',
  ])('retains specific evidence limitations and negated accusations: %s', difference => {
    const f = createTargetingFixture()
    f.fit.links[0].status = 'weak_signal'
    f.fit.links[0].difference = difference
    f.fit.links[0].expressionAngle = '前置参与方案交付的经历，保留参与，不写成独立负责。'
    const checked = validateJobFitMap(f.fit, f.targets, f.resume)
    expect(checked.value!.links[0].difference).toBe(difference)
    expect(checked.value!.links[0].expressionAngle).toBe(f.fit.links[0].expressionAngle)
  })

  test.each(['候选人不会进行产品规划。', '候选人缺乏产品规划能力。'])('normalizes unsupported negative assertions: %s', difference => {
    const f = createTargetingFixture()
    f.fit.links[0].status = 'weak_signal'
    f.fit.links[0].difference = difference
    expect(validateJobFitMap(f.fit, f.targets, f.resume).value!.links[0].difference).toContain('证据有限不代表')
  })

  test('keeps supported ownership advice but does not let a negated clause shield a positive upgrade', () => {
    const f = createTargetingFixture()
    f.fit.links[0].expressionAngle = '保留参与，不写成全权负责，但突出独立负责产品规划。'
    expect(validateJobFitMap(f.fit, f.targets, f.resume).value!.links[0].expressionAngle).toBe('')
    f.business.verbatimText = '独立负责产品规划与方案交付。'
    f.fit.links[0].expressionAngle = '前置独立负责产品规划的实践。'
    expect(validateJobFitMap(f.fit, f.targets, f.resume).value!.links[0].expressionAngle).toBe(f.fit.links[0].expressionAngle)
  })

  test.each(['3-5年', '至少3年工作经验', '工作经验3年以上'])('uses timeline verification for a pure years qualification: %s', text => {
    const f = createTargetingFixture()
    f.fit.narratives = []
    f.fit.links.forEach(link => { link.status = 'direct' })
    const requirement = f.job.requirementAtoms[0]
    Object.assign(requirement, { category: 'experience', normalizedRequirement: text })
    f.targets.find(target => target.id === requirement.requirementId)!.text = text
    const link = f.fit.links.find(item => item.targetId === requirement.requirementId)!
    Object.assign(link, { status: 'unknown', evidenceIds: [], difference: '未提供年限说明。', expressionAngle: '' })
    const [gap] = projectLegacyMatch(f.fit, f.targets, f.resume, f.job).gaps
    expect(gap.impact).toContain('已有任职时间线')
    expect(gap.safeHandling).toContain('起止时间、全职或实习性质及重叠周期')
    expect(gap.safeHandling).not.toContain('交付物')
    expect(gap.impact).not.toContain('未提供年限')
    f.resume.timeline = []
    expect(projectLegacyMatch(f.fit, f.targets, f.resume, f.job).gaps[0].impact).toContain('尚缺少可核对的任职起止时间')
  })

  test('uses education verification for an unknown degree without changing direct or explicit-gap judgments', () => {
    const f = createTargetingFixture()
    f.fit.narratives = []
    f.fit.links.forEach(link => { link.status = 'direct' })
    const requirement = f.job.requirementAtoms[0]
    Object.assign(requirement, { category: 'education', normalizedRequirement: '本科及以上学历' })
    f.targets.find(target => target.id === requirement.requirementId)!.text = requirement.normalizedRequirement
    const link = f.fit.links.find(item => item.targetId === requirement.requirementId)!
    Object.assign(link, { status: 'unknown', evidenceIds: [], difference: '未提供学历。', expressionAngle: '' })
    let match = projectLegacyMatch(f.fit, f.targets, f.resume, f.job)
    expect(match.gaps[0].safeHandling).toContain('最高学历、学位、专业及毕业状态')
    expect(match.gaps[0].safeHandling).not.toContain('交付物')
    Object.assign(link, { status: 'explicit_gap', evidenceIds: [f.business.evidenceId], difference: '材料明确为大专，与本科要求不一致。' })
    match = projectLegacyMatch(f.fit, f.targets, f.resume, f.job)
    expect(match.gaps[0].impact).toContain(link.difference)
    expect(match.gaps[0].safeHandling).toContain('如实保留')
    link.status = 'direct'
    expect(projectLegacyMatch(f.fit, f.targets, f.resume, f.job).gaps).toEqual([])
  })

  test('does not replace a compound experience gap with a years-only qualification message', () => {
    const f = createTargetingFixture()
    f.fit.narratives = []
    f.fit.links.forEach(link => { link.status = 'direct' })
    const requirement = f.job.requirementAtoms[0]
    Object.assign(requirement, { category: 'experience', normalizedRequirement: '具备3年以上全盘操盘经验并能独立负责产品线' })
    f.targets.find(target => target.id === requirement.requirementId)!.text = requirement.normalizedRequirement
    const link = f.fit.links.find(item => item.targetId === requirement.requirementId)!
    Object.assign(link, { status: 'weak_signal', difference: '材料尚未证明全盘操盘与独立负责产品线。' })
    const [gap] = projectLegacyMatch(f.fit, f.targets, f.resume, f.job).gaps
    expect(gap.impact).toContain(link.difference)
    expect(gap.impact).not.toContain('已有任职时间线')
  })

  test.each(['工作地点为长沙，薪资区间15-30K', '能接受每月到上海出差'])('uses preference and availability checks for a location condition: %s', text => {
    const f = createTargetingFixture()
    f.fit.narratives = []
    f.fit.links.forEach(link => { link.status = 'direct' })
    const requirement = f.job.requirementAtoms[0]
    Object.assign(requirement, { category: 'location', normalizedRequirement: text })
    f.targets.find(target => target.id === requirement.requirementId)!.text = text
    const link = f.fit.links.find(item => item.targetId === requirement.requirementId)!
    Object.assign(link, { status: 'unknown', evidenceIds: [], difference: '未提供相关材料。', expressionAngle: '' })
    const [gap] = projectLegacyMatch(f.fit, f.targets, f.resume, f.job).gaps
    expect(gap.impact).toContain('本人意向是否一致仍待确认')
    expect(gap.safeHandling).toContain('工作地点及岗位明确的到岗、出差安排')
    expect(gap.safeHandling).not.toContain('本人职责')
    expect(gap.safeHandling).not.toContain('交付物')
    Object.assign(link, { status: 'explicit_gap', evidenceIds: [f.business.evidenceId], difference: '本人明确只能在北京工作，不能接受岗位要求的长沙驻场。' })
    const explicit = projectLegacyMatch(f.fit, f.targets, f.resume, f.job).gaps[0]
    expect(explicit.impact).toContain(link.difference)
    expect(explicit.safeHandling).toContain('如实保留')
    link.status = 'direct'
    expect(projectLegacyMatch(f.fit, f.targets, f.resume, f.job).gaps).toEqual([])
  })

  test('does not apply availability advice to an unknown skill requirement', () => {
    const f = createTargetingFixture()
    f.fit.narratives = []
    f.fit.links.forEach(link => { link.status = 'direct' })
    const requirement = f.job.requirementAtoms.find(item => item.category === 'skill')!
    const link = f.fit.links.find(item => item.targetId === requirement.requirementId)!
    Object.assign(link, { status: 'unknown', evidenceIds: [], difference: '未提供SQL实践材料。', expressionAngle: '' })
    const [gap] = projectLegacyMatch(f.fit, f.targets, f.resume, f.job).gaps
    expect(gap.impact).toContain(link.difference)
    expect(gap.safeHandling).toContain('本人职责、交付物和可核验结果')
    expect(gap.safeHandling).not.toContain('到岗')
  })
})
