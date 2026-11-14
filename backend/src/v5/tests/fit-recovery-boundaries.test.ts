import {expect, test} from 'bun:test'
import {inspectFitRequirementScope, prepareJobFitScopeRepair, validateJobFitMap} from '@/v5/targeting/fit'
import {writingIssue} from '@/v5/writing/facts'
import {createTargetingFixture} from './targeting-fixtures'

test('broad industry experience does not authorize every financial specialty', () => {
  const f = createTargetingFixture()
  const target = {...f.targets[0]!, kind: 'requirement' as const, sourceQuote: '具有金融产品经验。'}
  const link = {...f.fit.links[0]!, targetId: target.id, similarity: '', expressionAngle: '',
    difference: '尚未提供银行风控或证券业务实践。'}
  expect(inspectFitRequirementScope(link, target)).toContain('JOB_FIT_FOREIGN_DOMAIN_GATE')
  expect(inspectFitRequirementScope({...link, difference: '金融产品实践的具体范围尚未说明。'}, target)).toEqual([])
  expect(inspectFitRequirementScope({...link, difference: '尚未提供风控业务实践。'},
    {...target, sourceQuote: '具有金融风控产品经验。'})).toEqual([])
  const repair = prepareJobFitScopeRepair({...f.fit, links: [link]}, [target], [
    writingIssue('JOB_FIT_FOREIGN_DOMAIN_GATE', target.id, [], '专项越界'),
  ])!
  expect(JSON.stringify(repair.currentOutput)).toContain('原文明示的行业条件应保留')
  expect(JSON.stringify(repair.currentOutput)).not.toContain('此原文没有限定金融')
})

test('independent thinking is not an independent delivery qualification', () => {
  const f = createTargetingFixture()
  const target = {...f.targets[0]!, kind: 'requirement' as const, sourceQuote: '具有独立思考和分析问题的能力。'}
  const link = {...f.fit.links[0]!, similarity: '', expressionAngle: '', difference: '尚未证明独立负责产品交付。'}
  expect(inspectFitRequirementScope(link, target)).toContain('JOB_FIT_INVENTED_OWNERSHIP_GATE')
  expect(inspectFitRequirementScope(link, {...target, sourceQuote: '能够独立负责产品交付。'})).toEqual([])
  expect(inspectFitRequirementScope({...link, difference: '尚未证明独立设计产品方案。'}, target))
    .toContain('JOB_FIT_INVENTED_OWNERSHIP_GATE')
})

test('a rejected narrative recovers its safe aspect while other narratives remain valid', () => {
  const f = createTargetingFixture()
  const targets = f.targets.filter(target => ['task', 'attribute'].includes(target.kind)).slice(0, 2)
  expect(targets).toHaveLength(2)
  const statements = ['参与产品迭代，交付3个功能。', '参与团队产品迭代。']
  const fit = {...f.fit, links: targets.map((target, index) => ({targetId: target.id, status: 'transferable' as const,
    evidenceIds: [f.business.evidenceId], similarity: statements[index]!, difference: '当前材料仅支持团队参与范围。',
    expressionAngle: '保留参与和真实交付。', supportedAspects: [{text: statements[index]!, evidenceIds: [f.business.evidenceId]}],
    unprovenAspects: [], roleBoundary: '团队参与。'})),
  narratives: targets.map((target, index) => ({statement: index ? '独立主导团队全部产品交付。' : statements[0]!,
    targetIds: [target.id], evidenceIds: [f.business.evidenceId]}))}
  const checked = validateJobFitMap(fit, targets, f.resume)
  expect(checked.passed).toBe(true)
  expect(checked.value!.narratives.map(item => item.statement)).toEqual(statements)
  expect(checked.value!.narrativeDiagnostics!.recovery).toBe('recovered_from_supported_aspects')
  expect(checked.issues.some(issue => issue.code === 'JOB_FIT_NARRATIVE_FACT_RISK')).toBe(true)
  expect(fit.narratives[1]!.statement).toContain('独立主导')
})
