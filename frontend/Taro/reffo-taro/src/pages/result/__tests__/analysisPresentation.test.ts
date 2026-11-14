beforeAll(() => { if (!globalThis.structuredClone) globalThis.structuredClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T })
import {createPlainCompletionDocument, serializeDraft} from '@/shared/resume-completion'
import {freezeActionPlan, freezeResolvedActionPlan, reconcileEditorialActions} from '@/shared/resume-actions'
import type {ProcessResult} from '@/types'
import {resumeTextFingerprint} from '@/shared/resume-strategy'
import {buildInterviewStoryViewItems} from '../model/interviewReferences'
import {
  buildGapViewItems,
  strategyResumeReference,
  isCurrentResumeReference,
  currentActionReview,
  buildOptimizationStrategyViewItems,
  buildOptimizationStrategyGroups,
  selectGapPreview,
  findResumeReferenceLines,
  hasStaleStrategyReview,
  representativeStrategyReference,
} from '../model/analysisPresentation'

function buildResult(): ProcessResult {
  return {
    analysis: {
      quality_score: 78,
      strengths: [],
      weaknesses: ['通用简历问题'],
      suggestions: [],
      capability_summary: '',
      structured_resume: {
        personal_info: {name: '张三'},
        education: [],
        experience: [],
        projects: [],
        skills: {hard_skills: [], soft_skills: []},
      },
    },
    matching: {
      match_score: 80,
      hard_requirements_match: [],
      skill_match: {matched_skills: [], missing_skills: [], match_percentage: 80},
      experience_match: {
        years_required: 0,
        years_actual: 0,
        relevant_experience: [],
        match_percentage: 80,
      },
      weaknesses: ['岗位匹配摘要'],
      weakness_details: [{
        id: 'G1',
        priority: 'high',
        weakness: '调研证据没有对齐岗位要求',
        evidence_type: 'wording_gap',
        jd_requirement: '负责用户调研',
        evidence: '源简历已有用户调研事实。',
        impact: '招聘方难以快速识别。',
        suggestion: '前置调研对象和产出。',
      }],
      optimization_suggestions: ['旧版策略摘要'],
      optimization_strategy_details: [{
        id: 'S1',
        related_gap_ids: ['G1'],
        strategy_point: '前置用户调研证据',
        rationale: '直接回应岗位的调研优先级。',
        optimization_example: {
          source_path: 'experience[0].responsibilities[0]',
          source_quote: '负责用户调研和方案落地',
          optimized_content: '围绕用户调研推进方案落地。',
        },
      }],
      jd_structure: undefined,
    },
    optimized: {optimized_resume: '', changes_summary: [], improvement_score: 0},
    interview: {questions: [], story_recommendations: [], follow_up_questions: []},
  }
}

describe('analysis presentation', () => {
  test('讲述要点与明确的源简历引用一同保留', () => {
    const result = buildResult()
    result.interview.story_recommendations = [{
      title: '用户调研', background: '负责用户调研', result: '推进方案落地',
      storytelling_approach: ['  先说明调研背景  ', '说明本人负责的工作', ''],
      source_references: [{evidence_id: 'research-evidence', source_scope_id: 'experience',
        source_quote: '负责用户调研和方案落地', source_kind: 'source_resume'}],
    }]
    const [story] = buildInterviewStoryViewItems(result, '负责用户调研和方案落地', '岗位要求用户调研')
    expect(story.storytellingApproach).toEqual(['先说明调研背景', '说明本人负责的工作'])
    expect(story.sourceReferences).toEqual(result.interview.story_recommendations[0].source_references)
    expect(story.sourceGroups).toMatchObject([{sourceKind: 'source_resume', evidenceIds: ['research-evidence'],
      paragraphs: ['负责用户调研和方案落地']}])
    expect(story.jdReferences).toEqual([])
  })

  test('历史故事没有来源引用时保留正文，不从简历或岗位原文猜测', () => {
    const result = buildResult()
    result.interview.story_recommendations = [{
      title: '用户调研', background: '负责用户调研', result: '推进方案落地',
      storytelling_approach: [],
    }]
    const [story] = buildInterviewStoryViewItems(result, '负责用户调研和方案落地', '岗位要求用户调研')
    expect(story).toMatchObject({title: '用户调研', background: '负责用户调研', result: '推进方案落地'})
    expect(story.storytellingApproach).toEqual([])
    expect(story.sourceReferences).toEqual([])
    expect(story.sourceGroups).toEqual([])
    expect(story.jdReferences).toEqual([])
  })

  test('does not create generic stories when recommendations have not been generated', () => {
    expect(buildInterviewStoryViewItems(buildResult(), '负责用户调研和方案落地', '岗位要求用户调研')).toEqual([])
  })

  test('uses JD-specific structured gaps instead of generic resume weaknesses', () => {
    const gaps = buildGapViewItems(buildResult())

    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({
      id: 'G1',
      title: '调研证据没有对齐岗位要求',
      jdRequirement: '负责用户调研',
      priority: 'high',
    })
  })

  test('必要条件全部常驻，普通项默认三条且不修改原始次序', () => {
    const result = buildResult()
    const base = result.matching.weakness_details![0]
    result.matching.weakness_details = Array.from({length: 7}, (_, index) => ({
      ...base, id: `G${index}`, priority: 'medium', is_required: index >= 3,
    }))
    const gaps = buildGapViewItems(result, Infinity)
    expect(selectGapPreview(gaps).map(item => item.id)).toEqual(['G3', 'G4', 'G5', 'G6'])
    expect(gaps.map(item => item.id)).toEqual(['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6'])
    expect(selectGapPreview(gaps, Infinity)).toHaveLength(7)
  })

  test('旧记录的高优先项不折叠，明确非必要的普通高优先项仍可收起', () => {
    const result = buildResult()
    const base = result.matching.weakness_details![0]
    result.matching.weakness_details = Array.from({length: 5}, (_, index) => ({...base, id: `G${index}`}))
    expect(selectGapPreview(buildGapViewItems(result, Infinity))).toHaveLength(5)
    result.matching.weakness_details = result.matching.weakness_details.map(item => ({...item, is_required: false}))
    expect(selectGapPreview(buildGapViewItems(result, Infinity))).toHaveLength(3)
  })

  test('keeps strategy explanation and exact before-after example together', () => {
    const strategies = buildOptimizationStrategyViewItems(buildResult())

    expect(strategies[0]).toMatchObject({
      strategyPoint: '前置用户调研证据',
      rationale: '直接回应岗位的调研优先级。',
      sourceQuote: '负责用户调研和方案落地',
      optimizedContent: '围绕用户调研推进方案落地。',
      structured: true,
    })
  })

  test('falls back to legacy matching strings', () => {
    const result = buildResult()
    result.matching.weakness_details = []
    result.matching.optimization_strategy_details = []

    expect(buildGapViewItems(result)[0]?.title).toBe('岗位匹配摘要')
    expect(buildOptimizationStrategyViewItems(result)[0]).toMatchObject({
      strategyPoint: '旧版策略摘要',
      structured: false,
    })
  })

  test('never substitutes resume quality weaknesses for missing job gaps', () => {
    const result = buildResult()
    result.matching.weakness_details = []
    result.matching.weaknesses = []
    expect(buildGapViewItems(result)).toEqual([])
  })

  test('allows H5 to show every gap and strategy without silent truncation', () => {
    const result = buildResult()
    result.matching.weakness_details = []
    result.matching.optimization_strategy_details = []
    result.matching.weaknesses = Array.from({length: 7}, (_, i) => `差距${i + 1}`)
    result.matching.optimization_suggestions = Array.from({length: 7}, (_, i) => `策略${i + 1}`)
    expect(buildGapViewItems(result, Infinity)).toHaveLength(7)
    expect(buildOptimizationStrategyViewItems(result, Infinity)).toHaveLength(7)
  })
})

test('同一实际实践归为能力主题，保留全部动作和关系并优先必要条件', () => {
  const result = buildResult()
  const baseAction = {title: '前置研究产出', requirementIds: ['R1'], analysisGapIds: ['G1'], aspectIds: ['R1'],
    operation: 'express_supported_aspect' as const, sourceScopeIds: ['scope-research'], evidenceIds: ['e1'], detailIds: [],
    expectedEffect: '用真实调研动作回应要求', successConditions: [{aspectId: 'R1', criterion: '呈现研究产出'}], protectedBoundaries: [],
    eligibility: 'executable' as const, planningState: 'proposed' as const, intendedScopeIds: ['scope-research'], origin: 'matching' as const}
  result.matching.weakness_details = [{id: 'required', weakness: '必要资格待核对', is_required: true, evidence_type: 'direct_missing', evidence: '', suggestion: '补充资格依据'},
    ...Array.from({length: 6}, (_, index) => ({id: `G${index}`, weakness: `研究方面${index}`, evidence_type: 'wording_gap' as const, evidence: '研究材料', suggestion: '使用同一研究发现'}))]
  result.matching.action_plan = freezeActionPlan({planId: 'themes', sourceRevision: 'source', judgmentRevision: 'judgment', actions: [
    ...Array.from({length: 6}, (_, index) => ({...baseAction, actionId: `action-${index}`, requirementIds: [`R${index}`], analysisGapIds: [`G${index}`]})),
    {...baseAction, actionId: 'qualification', title: '核对必要资格', operation: 'preparation_only', eligibility: 'needs_user_fact',
      requirementIds: ['required'], analysisGapIds: ['required'], sourceScopeIds: [], evidenceIds: []},
  ]})
  const groups = buildOptimizationStrategyGroups(result)
  expect(groups).toHaveLength(2)
  expect(groups[0].actionIds).toEqual(['qualification'])
  expect(groups[1].actionIds).toHaveLength(6)
  expect(groups[1].requirementIds).toHaveLength(6)
  expect(groups[1].relatedGapIds).toHaveLength(6)
  expect(result.matching.action_plan.actions).toHaveLength(7)
})

describe('strategy outcome presentation', () => {
  test('只关联相同策略ID的当前说明，已对应正文的策略优先展示', () => {
    const result = buildResult()
    const detail = result.matching.optimization_strategy_details![0]
    result.matching.optimization_strategy_details = [2, 3, 4, 5].map(index => ({...detail, id: `S${index}`})).concat(detail)
    result.optimized.optimized_resume = '# 张三\n- 围绕用户调研推进方案落地。'
    result.optimized.strategy_review = {
      version: 'resume-strategy-v1', resumeFingerprint: resumeTextFingerprint(result.optimized.optimized_resume),
      items: [{strategyId: 'S1', strategy: '前置用户调研', status: 'linked', explanation: '项目经历保留调研与交付事实。',
        references: [{outputPath: 'projects[0]', location: '项目经历', quote: '围绕用户调研推进方案落地。'}]}],
    }
    const items = buildOptimizationStrategyViewItems(result)
    expect(items).toHaveLength(4)
    expect(items[0].id).toBe('S1')
    expect(items[0].outcome?.status).toBe('linked')
    expect(items[1].outcome).toBeUndefined()
    expect(representativeStrategyReference(items[0].outcome, result.optimized.optimized_resume)?.location).toBe('项目经历')
    result.optimized.optimized_resume += '\n手动补充'
    expect(hasStaleStrategyReview(result)).toBe(true)
    expect(buildOptimizationStrategyViewItems(result).every(item => !item.outcome)).toBe(true)
  })

  test('只定位唯一的原句，跨行可定位，空白、不存在或多处命中均不猜测', () => {
    expect(findResumeReferenceLines('# 简历\n- 调研\n- 交付', '调研\n- 交付')).toEqual({start: 1, end: 2})
    expect(findResumeReferenceLines('参与调研\n参与调研', '参与调研')).toBeUndefined()
    expect(findResumeReferenceLines('参与調研', '参与调研')).toBeUndefined()
    expect(findResumeReferenceLines('正文', ' ')).toBeUndefined()
  })

  test('建议示例和未选入策略都不能成为生成正文引用', () => {
    const result = buildResult()
    expect(representativeStrategyReference(buildOptimizationStrategyViewItems(result)[0].outcome, '围绕用户调研推进方案落地。')).toBeUndefined()
    expect(representativeStrategyReference({strategyId: 'S1', strategy: '建议', status: 'not_selected', explanation: '',
      references: [{outputPath: 'projects[0]', location: '项目经历', quote: '正文'}]}, '正文')).toBeUndefined()
  })
})

describe('行动方案与正文联动', () => {
  test('不截断策略关联实体，展示当前版本状态并仅定位有效稳定锚点', () => {
    const result = buildResult()
    const document = createPlainCompletionDocument('- 完成用户访谈并整理需求清单。', {documentId: 'action-document'})
    const action = {actionId: 'action-research', title: '前置用户调研产出', requirementIds: ['R1'],
      analysisGapIds: ['G1', 'G2', 'G3', 'G4', 'G5'], aspectIds: ['aspect-research'], operation: 'express_supported_aspect' as const,
      sourceScopeIds: ['source-1'], evidenceIds: ['e1'], detailIds: [], expectedEffect: '回应用户研究要求',
      successConditions: [{aspectId: 'aspect-research', criterion: '展示调研产出，尚不能证明独立统筹'}],
      protectedBoundaries: ['参与贡献'], eligibility: 'executable' as const, planningState: 'proposed' as const,
      intendedScopeIds: ['experience-1'], origin: 'matching' as const}
    const plan = freezeActionPlan({planId: 'plan', sourceRevision: 'source', judgmentRevision: 'judgment', actions: [action]})
    const resolved = freezeResolvedActionPlan({resolvedPlanId: 'resolved', revision: 0, basePlanId: plan.planId,
      baseDigest: plan.baseDigest, actions: [action], bindings: [{actionId: action.actionId, selection: 'selected', selectionReason: null}]})
    result.optimized = {...result.optimized, optimized_resume: serializeDraft(document), completion_document: document,
      action_plan: plan, resolved_action_plan: resolved}
    result.optimized.action_review = reconcileEditorialActions({resolvedPlan: resolved, document, outcomes: [{actionId: action.actionId,
      state: 'partially_adopted', explanation: '已有调研产出，未证实统筹责任', anchors: [{blockId: document.blocks[0].blockId,
        location: '工作经历', quote: '完成用户访谈并整理需求清单。'}], coveredAspectIds: [], remainingAspectIds: ['aspect-research'],
      validation: 'deterministic', source: 'compiler'}]})
    const [item] = buildOptimizationStrategyViewItems(result)
    expect(item.relatedGapIds).toHaveLength(5)
    expect(item.actionOutcome?.state).toBe('partially_adopted')
    const reference = strategyResumeReference(item, result)!
    expect('blockId' in reference).toBe(true)
    expect(isCurrentResumeReference(reference, result)).toBe(true)
    const modified = {...createPlainCompletionDocument('- 仅完成记录整理。', {documentId: document.documentId}), revision: 1}
    result.optimized.completion_document = modified
    result.optimized.optimized_resume = serializeDraft(modified)
    expect(currentActionReview(result)).toBeUndefined()
    expect(isCurrentResumeReference(reference, result)).toBe(false)
    expect(buildOptimizationStrategyViewItems(result)[0].actionOutcome).toBeUndefined()
    expect(result.matching.match_score).toBe(80)
  })
})

test('精确保留用户补充引用，空引用和历史岗位ID不触发猜测', () => {
  const result = buildResult()
  const jdContent = '岗位要求调研'
  result.matching.jd_structure = {basic_info: {title: '产品经理'}, hard_requirements: {required_skills: []},
    responsibilities: [], tasks: [], soft_skills: [], nice_to_have: [], requirement_sources: [
      {requirement_id: 'R1', source_quote: jdContent, source_block_id: 'jd-block', source_span: {start: 0, end: jdContent.length}},
    ]}
  result.interview.story_recommendations = [{title: '用户调研', background: '实际访谈背景', result: '形成报告', storytelling_approach: ['准备说明本人角色'],
    source_references: [{evidence_id: 'user-detail', source_scope_id: 'experience', source_quote: '完成三名用户访谈', source_kind: 'user_fact'}],
    related_requirement_ids: ['R1'], action_ids: ['action-1']},
  {title: '另一个故事', background: '', result: '', storytelling_approach: [], source_references: []}]
  const items = buildInterviewStoryViewItems(result, '源简历里只写参与需求梳理', jdContent)
  expect(items[0].sourceReferences).toEqual(result.interview.story_recommendations[0].source_references)
  expect(items[0].sourceGroups).toMatchObject([{sourceKind: 'user_fact', evidenceIds: ['user-detail'], paragraphs: ['完成三名用户访谈']}])
  expect(items[0].jdReferences).toEqual([])
  expect(items[1].sourceReferences).toEqual([])
  expect(items[1].sourceGroups).toEqual([])
  expect(items[1].jdReferences).toEqual([])
})
