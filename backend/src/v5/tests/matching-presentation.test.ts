import { expect, test } from 'bun:test'
import { matchAnalysisSchema } from '@/schemas/match-analysis'
import { toMatchAnalysis } from '@/v5/main/compatibility'
import { calculateV5MatchScore } from '@/v5/match-score'
import { compileV5Prompt } from '@/v5/prompt-compiler'
import { projectLegacyMatch, validateJobFitMap } from '@/v5/targeting/fit'
import { createTargetingFixture } from './targeting-fixtures'
import type { RequirementCategory, RequirementImportance } from '@/v5/types'

function present(fixture: ReturnType<typeof createTargetingFixture>) {
  const match = projectLegacyMatch(fixture.fit, fixture.targets, fixture.resume, fixture.job)
  const score = calculateV5MatchScore({resume:fixture.resume,job:fixture.job,match})
  return {match,score,publicResult:toMatchAnalysis({resumeEvidenceBundle:fixture.resume,
    jobRequirementBundle:fixture.job,matchAnalysis:match,matchScore:score})}
}

test('a punctuated job statement stays in details instead of being concatenated into the gap', () => {
  const fixture = createTargetingFixture()
  const target = fixture.targets.find(item => item.kind === 'task')!
  target.text = '负责产品规划与数据分析，并参与跨团队交付。'
  const link = fixture.fit.links.find(item => item.targetId === target.id)!
  link.difference = '已有参与交付的实践，但材料未说明独立规划的范围。'
  link.expressionAngle = '展开已参与的交付过程，保留协同贡献边界。'
  const before = structuredClone(fixture)
  const {match,publicResult} = present(fixture)
  const gap = match.gaps.find(item => item.gapId === `target_gap_${target.id}`)!
  const detail = publicResult.weakness_details!.find(item => item.id === gap.gapId)!
  expect(detail.weakness).toBe(link.difference)
  expect(detail.impact).toBe(link.difference)
  expect(detail.weakness).not.toContain('。：')
  expect(detail.weakness).not.toContain(target.text)
  expect(detail.jd_requirement).toBe(fixture.job.requirementAtoms.find(item => item.requirementId === gap.requirementIds[0])!.verbatimText)
  expect(detail.evidence).toBe(fixture.business.verbatimText)
  expect(detail.suggestion).toBe(link.expressionAngle)
  const strategy = publicResult.optimization_strategy_details!.find(item => item.related_gap_ids.includes(gap.gapId))!
  expect(strategy.id).toBe(`strategy_${gap.gapId}`)
  expect(strategy.strategy_point).toBe(link.expressionAngle)
  expect(strategy.rationale).toBe(link.difference)
  expect(strategy.optimization_example).toEqual({source_path:'',source_quote:fixture.business.verbatimText,optimized_content:''})
  expect(fixture).toEqual(before)
})

test('long qualified judgments are retained without a new display-length validation failure', () => {
  const fixture = createTargetingFixture()
  const link = fixture.fit.links.find(item => item.targetId === 'job:task:t1')!
  link.difference = '已有参与需求整理、方案沟通和交付跟进的实践；这些证据仅覆盖团队协同中的已知职责，材料尚未说明独立制定长期规划的范围，也不能据此认定没有相关能力。'
  link.expressionAngle = '展开已参与的需求整理和交付跟进过程，保留团队协同归因；结果未经验证的部分仍按当前阶段表述，不写成独立主导或已实现量化效果。'
  const checked = validateJobFitMap(fixture.fit,fixture.targets,fixture.resume)
  expect(checked.passed).toBe(true)
  const gap = present({...fixture,fit:checked.value!}).match.gaps.find(item => item.gapId === 'target_gap_job:task:t1')!
  expect(gap.impact).toBe(link.difference)
  expect(gap.safeHandling).toBe(link.expressionAngle)
})

test('strategy IDs follow gaps across sorting and identical advice keeps distinct qualification links', () => {
  const fixture = createTargetingFixture()
  const {match,score,publicResult} = present(fixture)
  const reordered = toMatchAnalysis({resumeEvidenceBundle:fixture.resume,jobRequirementBundle:fixture.job,
    matchAnalysis:{...match,gaps:[...match.gaps].reverse()},matchScore:score})
  for (const strategy of publicResult.optimization_strategy_details!) {
    expect(reordered.optimization_strategy_details!.find(item => item.id === strategy.id)).toEqual(strategy)
  }
  expect(publicResult.optimization_strategy_details).toHaveLength(match.gaps.length)
  expect(new Set(publicResult.optimization_strategy_details!.map(item => item.id)).size).toBe(match.gaps.length)
})

test.each(['unknown','explicit_gap','conflicted'] as const)('%s fallback advice does not repeat the job paragraph or change the underlying judgment', status => {
  const fixture = createTargetingFixture()
  const target = fixture.targets.find(item => item.kind === 'task')!
  target.text = '负责从需求调研、方案制定到跨团队交付的完整任务，并处理具体业务约束。'
  const link = fixture.fit.links.find(item => item.targetId === target.id)!
  link.status = status
  link.expressionAngle = ''
  if (status === 'unknown') fixture.fit.links.filter(item => item === link || target.requirementIds.includes(item.targetId))
    .forEach(item => { item.status = 'unknown'; item.evidenceIds = [] })
  const before = structuredClone(fixture.fit)
  const gap = present(fixture).match.gaps.find(item => item.gapId === `target_gap_${target.id}`)!
  expect(gap.safeHandling).not.toContain(target.text)
  expect(gap.impact).not.toContain(target.text)
  expect(fixture.fit).toEqual(before)
  expect(gap.safeHandling).toContain(status === 'unknown' ? '不写成已有能力' : status === 'explicit_gap' ? '不改写为已满足' : '先核对')
  const strategy = present(fixture).publicResult.optimization_strategy_details!.find(item => item.related_gap_ids.includes(gap.gapId))!
  expect(strategy.related_gap_ids).toEqual([gap.gapId])
  expect(strategy.optimization_example.optimized_content).toBe('')
  if (status === 'unknown') expect(strategy.optimization_example.source_quote).toBe('')
})

const requiredCases: Array<[RequirementCategory,RequirementImportance,'explicit'|'semantic_summary',boolean]> = [
  ['education','must_have','explicit',true],['experience','must_have','explicit',true],
  ['skill','must_have','explicit',true],['language','must_have','explicit',true],
  ['certification','must_have','explicit',true],['location','must_have','explicit',true],
  ['schedule','must_have','explicit',true],['skill','differentiator','explicit',false],
  ['experience','must_have','semantic_summary',false],['responsibility','must_have','explicit',false],
  ['outcome','core_outcome','explicit',false],['other','must_have','explicit',false],
]
test.each(requiredCases)('required display flag follows explicit qualification, not high priority: %s/%s/%s', (category,importance,explicitness,expected) => {
  const fixture = createTargetingFixture()
  const {match} = present(fixture)
  const requirement = fixture.job.requirementAtoms[0]
  Object.assign(requirement,{category,importance,explicitness})
  match.gaps = [{gapId:'qualification',requirementIds:[requirement.requirementId],priority:'high',
    evidenceType:'direct_missing',evidenceIds:[],impact:'材料未说明相关条件。',safeHandling:'核对相关材料。'}]
  const score = calculateV5MatchScore({resume:fixture.resume,job:fixture.job,match})
  const result = toMatchAnalysis({resumeEvidenceBundle:fixture.resume,jobRequirementBundle:fixture.job,matchAnalysis:match,matchScore:score})
  expect(result.weakness_details![0].is_required).toBe(expected)
  expect(matchAnalysisSchema.parse(result).weakness_details![0].is_required).toBe(expected)
  delete result.weakness_details![0].is_required
  expect(matchAnalysisSchema.parse(result).weakness_details![0].is_required).toBeUndefined()
})

test.each(['P03','P03R'] as const)('%s keeps display length soft and preserves qualification and source boundaries', component => {
  const prompt = compileV5Prompt({component,envelope:{payload:{jobTargetingPolicy:'job-targeted-v1'}}})
  const system = prompt.messages[0].content
  expect(system).toContain('difference只写差距判断')
  expect(system).toContain('一个主要编辑动作')
  expect(system).toContain('字数是软参考，不机械截断、不删限定词')
  expect(system).toContain('建议是生成前计划')
})
