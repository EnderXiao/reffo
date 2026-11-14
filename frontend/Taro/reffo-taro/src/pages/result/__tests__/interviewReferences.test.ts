import {buildInterviewPreparationView, buildInterviewStoryViewItems, resolveInterviewJobReferences, upgradeInterviewPresentation, interviewSourceHeading} from '../model/interviewReferences'
import {completionResult} from './completionFixture'
import {requirementAnalysisFixture} from '@/utils/__tests__/fixtures/requirement-analysis'
import type {InterviewPreparationTopic, InterviewPresentation} from '@/types'

const topic = (topicId: string, scopeId: string, evidenceId: string): InterviewPreparationTopic => ({topicId, scopeId, subject: '方案有效率',
  dimensions: ['definition'], sourceEvidenceIds: [evidenceId], sourceSpans: [], requirementIds: [], actionIds: [],
  sourceAssertionStatus: 'recorded', sourceStatement: '有效率 95%', prompt: `${topicId}的有效率如何计算？`, preparationFocus: '准备计算方式与统计范围。'})
const presentation = (): InterviewPresentation => ({version: 'interview-presentation-v1', questions: [], stories: []})

describe('岗位稳定引用', () => {
  const jd = '负责会员增长策略并推动跨部门落地。\nSQL 使用经验优先。\n具备用户调研经验。'
  test('只沿显式岗位ID引用原文，动作ID不能扩散关联', () => {
    const result = completionResult()
    result.matching.requirement_analysis = requirementAnalysisFixture
    expect(resolveInterviewJobReferences(result, ['qualification'], ['unknown-action'], jd)).toEqual([
      {requirementId: 'qualification', quote: 'SQL 使用经验优先。'},
    ])
    expect(resolveInterviewJobReferences(result, [], ['action-sql'], jd)).toEqual([])
    expect(resolveInterviewJobReferences(result, ['qualification'], [], '具备用户调研经验。')).toEqual([])
  })
  test('服务端标准岗位引用只接受相同ID和实际原文', () => {
    const result = completionResult()
    result.matching.jd_structure = {basic_info: {title: '产品经理'}, hard_requirements: {required_skills: []},
      responsibilities: [], tasks: [], soft_skills: [], nice_to_have: [], requirement_sources: [
        {requirement_id: 'req-42', source_quote: '具备用户调研经验。', source_block_id: 'block-7', source_span: {start: 0, end: 10}},
      ]}
    expect(resolveInterviewJobReferences(result, ['req-42'], [], jd)).toEqual([{requirementId: 'req-42', quote: '具备用户调研经验。'}])
    expect(resolveInterviewJobReferences(result, ['req-other'], [], jd)).toEqual([])
  })
})

describe('故事引用投影', () => {
  test('损坏的同版本展示数据回退故事正文，不抛错或猜测引用', () => {
    const result = completionResult()
    result.interview.story_recommendations = [{title: '项目', background: '调研', result: '形成报告', storytelling_approach: []}]
    Object.assign(result.interview, {presentation: {version: 'interview-presentation-v1', questions: [{}], stories: [{sourceGroups: null}]}})
    expect(() => buildInterviewStoryViewItems(result, '', '')).not.toThrow()
    expect(buildInterviewStoryViewItems(result, '', '')[0].result).toBe('形成报告')
  })
  test('没有稳定引用时保留故事，但不从源文或JD猜摘录', () => {
    const result = completionResult()
    result.interview.story_recommendations = [{title: '项目', background: '调研', result: '形成报告', storytelling_approach: []}]
    const [story] = buildInterviewStoryViewItems(result, '主导相关调研', '熟悉用户调研')
    expect(story.sourceGroups).toEqual([])
    expect(story.jdReferences).toEqual([])
    expect(story.background).toBe('调研')
    expect(story).not.toHaveProperty('fullJd')
  })
  test('旧记录可靠引用按scope和来源类型分组，保留数字和未上线边界，不猜拼断行', () => {
    const result = completionResult()
    const ref = (id: string, quote: string, kind: 'source_resume' | 'user_fact' = 'source_resume') => ({evidence_id: id, source_scope_id: 'scope', source_quote: quote, source_kind: kind})
    result.interview.story_recommendations = [{title: '员工助手', background: '', result: '', storytelling_approach: [], related_requirement_ids: ['old-derived'],
      source_references: [ref('title', '## 员工助手2.0'), ref('stage', 'C | 研究阶段'), ref('one', '关键动作 主导问卷、10+'),
        ref('two', '家门店调研，尚未上线。'), ref('two', '家门店调研，尚未上线。'), ref('user', '本人完成两家门店访谈', 'user_fact')]}]
    const [story] = buildInterviewStoryViewItems(result, '', '')
    expect(story.sourceGroups).toHaveLength(2)
    expect(story.sourceGroups[0]).toMatchObject({label: '员工助手2.0', stage: '研究阶段', paragraphs: ['关键动作 主导问卷、10+', '家门店调研，尚未上线。']})
    expect(story.sourceGroups[1].sourceKind).toBe('user_fact')
    expect(story.jdReferences).toEqual([])
  })
  test('新投影用稳定storyId连接，同名故事不串来源', () => {
    const result = completionResult()
    result.interview.story_recommendations = ['a', 'b'].map(id => ({story_id: id, title: '同名项目', background: '', result: '', storytelling_approach: []}))
    result.interview.presentation = {...presentation(), stories: ['b', 'a'].map(id => ({storyId: id, title: '同名项目', scopeId: 'same-employer', sourceGroups: [],
      jobReferences: [{requirementId: id, quote: `岗位${id}`}], topics: []}))}
    expect(buildInterviewStoryViewItems(result, '', '').map(story => story.jdReferences[0].requirementId)).toEqual(['a', 'b'])
  })
})

describe('面试准备主题归属', () => {
  test('服务端投影为唯一权威来源，主题在问题和故事间只出现一次', () => {
    const result = completionResult()
    const linked = topic('linked', 'scope', 'ev')
    result.optimized.preparation_topics = [topic('old', 'scope', 'ev')]
    result.interview.story_recommendations = [{story_id: 's', title: '项目故事', background: '', result: '', storytelling_approach: []}]
    result.interview.presentation = {...presentation(), questions: [{questionId: 'q', question: '请介绍方法', category: 'project_deep_dive', preparationFocus: '说明取舍',
      sourceEvidenceIds: ['ev'], requirementIds: [], topics: [linked]}], stories: [{storyId: 's', title: '项目故事', scopeId: 'scope', sourceGroups: [], jobReferences: [], topics: [linked]}]}
    const prepared = buildInterviewPreparationView(result, buildInterviewStoryViewItems(result, '', ''))
    expect(prepared.questionTopics[0].map(item => item.topicId)).toEqual(['linked'])
    expect(prepared.storyTopics).toEqual([[]])
  })
  test('旧主题只接受唯一直接证据匹配，不按scope或首个故事分配，不展示孤立卡', () => {
    const result = completionResult()
    const ref = {evidence_id: 'ev', source_scope_id: 'scope', source_kind: 'source_resume' as const, source_quote: '主导调研'}
    result.interview.preparation_topics = [topic('linked', 'scope', 'ev'), topic('orphan', 'other', 'missing')]
    result.optimized.preparation_topics = [topic('stale', 'scope', 'ev')]
    result.interview.story_recommendations = [{title: '故事', background: '', result: '', storytelling_approach: [], source_references: [ref]}]
    let prepared = buildInterviewPreparationView(result, buildInterviewStoryViewItems(result, '', ''))
    expect(prepared.storyTopics[0].map(item => item.topicId)).toEqual(['linked'])
    expect(prepared).not.toHaveProperty('questionGroups')
    result.interview.story_recommendations.push({...result.interview.story_recommendations[0], title: '另一个故事'})
    prepared = buildInterviewPreparationView(result, buildInterviewStoryViewItems(result, '', ''))
    expect(prepared.storyTopics).toEqual([[], []])
  })
})


describe('面试展示升级', () => {
  test('仅同源面试可升级展示，保留本地正文与其他面试字段', () => {
    const local = completionResult()
    const remote = JSON.parse(JSON.stringify(local)) as typeof local
    local.optimized.optimized_resume = '本地填写稿'
    remote.interview.presentation = presentation()
    remote.interview.story_recommendations.forEach((story, index) => {story.story_id = `story-${index}`})
    const upgraded = upgradeInterviewPresentation(local, remote)
    expect(upgraded.optimized).toBe(local.optimized)
    expect(upgraded.interview.presentation).toEqual(remote.interview.presentation)
    expect(upgraded.interview.questions).toBe(local.interview.questions)
    remote.interview.questions = ['远端其他面试']
    expect(upgradeInterviewPresentation(local, remote)).toBe(local)
  })
  test('本地已重新生成或已有投影不被远端旧面试覆盖', () => {
    const local = completionResult()
    const remote = JSON.parse(JSON.stringify(local)) as typeof local
    remote.interview.presentation = presentation()
    local.interview.based_on_document = {documentId: 'new', revision: 2}
    remote.interview.based_on_document = {documentId: 'new', revision: 1}
    expect(upgradeInterviewPresentation(local, remote)).toBe(local)
    local.interview.based_on_document = remote.interview.based_on_document
    local.interview.presentation = {...presentation(), basedOnDocument: {documentId: 'new', revision: 2}}
    expect(upgradeInterviewPresentation(local, remote)).toBe(local)
  })
  test('引用标题显示原案例名，重复故事名和阶段只出现一次', () => {
    const group = {sourceKind: 'source_resume' as const, label: '员工助手研究', stage: '研究阶段', evidenceIds: [], spans: [], paragraphs: []}
    expect(interviewSourceHeading(group, '一线调研方法')).toBe('源简历依据 · 员工助手研究 · 研究阶段')
    expect(interviewSourceHeading({...group, label: '一线调研方法'}, '一线调研方法')).toBe('源简历依据 · 研究阶段')
    expect(interviewSourceHeading({...group, sourceKind: 'user_fact', label: '研究阶段'}, '一线调研方法')).toBe('用户补充（尚未经独立核验） · 研究阶段')
  })
})
