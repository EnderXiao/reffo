import {apiClient} from '../api'
import {ResumeApi} from '../resume'
import {ResumeHistoryApi} from '../resumeHistory'
import {requirementAnalysisFixture} from '@/utils/__tests__/fixtures/requirement-analysis'
import type {ResumeHistory} from '@/types'

describe('requirement analysis API and history round trip', () => {
  afterEach(() => jest.restoreAllMocks())
  test('both full-process and matching APIs retain the same optional view without changing scores', async () => {
    const analysis = {quality_score: 90, strengths: [], weaknesses: [], suggestions: [], capability_summary: '', structured_resume: {personal_info: {name: '测试'}, education: [], experience: [], projects: [], skills: {hard_skills: [], soft_skills: []}}}
    const matching = {match_score: 20, skill_match: {matched: [], missing: []}, experience_match: '', requirement_analysis: requirementAnalysisFixture}
    jest.spyOn(apiClient, 'post').mockResolvedValueOnce(matching).mockResolvedValueOnce({step1_analysis: analysis, step2_matching: matching, step3_optimized_resume: '已有真实经历'} )
    const service = new ResumeApi()
    const partial = await service.matchResume(analysis, '负责会员增长策略并推动跨部门落地。')
    const complete = await service.processResume('这是一份足够长度的测试源简历。', '负责会员增长策略并推动跨部门落地。')
    expect(partial.requirement_analysis).toEqual(requirementAnalysisFixture)
    expect(complete.matching.requirement_analysis).toEqual(requirementAnalysisFixture)
    expect(complete.matching.match_score).toBe(20)
    expect(complete.analysis.quality_score).toBe(90)

    const history: ResumeHistory = {id: 'test-id', position: '增长产品', company: '测试', name: '测试', createdAt: '2026-09-06', qualityScore: 90, matchScore: 20, tags: [], resumeContent: '测试资料', jdContent: '测试岗位', optimizedContent: complete.optimized.optimized_resume, processResult: complete}
    let stored: unknown
    jest.spyOn(apiClient, 'post').mockImplementation(async (_url, payload) => {stored = JSON.parse(JSON.stringify(payload)); return stored as never})
    const histories = new ResumeHistoryApi()
    const saved = await histories.saveHistory(history)
    jest.spyOn(apiClient, 'get').mockResolvedValue(stored)
    const restored = await histories.getHistory('test-id')
    expect(saved.processResult?.matching.requirement_analysis).toEqual(requirementAnalysisFixture)
    expect(restored.processResult?.matching.requirement_analysis).toEqual(requirementAnalysisFixture)
  })
})
