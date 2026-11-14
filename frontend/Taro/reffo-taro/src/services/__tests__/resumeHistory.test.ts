import {actionContentDigest} from '@/shared/resume-actions'
import {apiClient} from '../api'
import {resumeHistoryApi} from '../resumeHistory'
import {completionResult} from '@/pages/result/__tests__/completionFixture'

const generated = completionResult()
const record = {id: 'history', position: '产品经理', company: '公司', name: '', created_at: '2026-11-12', updated_at: '2026-11-12',
  quality_score: 80, match_score: null, tags: [], resume_content: '源文', jd_content: '岗位', optimized_content: generated.optimized.optimized_resume,
  process_result: {...generated, matching: {...generated.matching, match_score: null, hard_requirements_match: {'五年经验': null},
    skill_match: {matched: ['需求分析'], missing: []}, experience_match: '起止月份不足，不能估算年限'}}}

afterEach(() => jest.restoreAllMocks())

test('可信历史的后端匹配形态归一化后才能进入结果页', async () => {
  jest.spyOn(apiClient, 'get').mockResolvedValue(record)
  const history = await resumeHistoryApi.getHistory('history')
  expect(history.name).toBe('')
  expect(history.matchScore).toBeNull()
  expect(history.processResult?.matching.hard_requirements_match).toEqual([{requirement: '五年经验', matched: null}])
  expect(history.processResult?.matching.skill_match.matched_skills).toEqual(['需求分析'])
  expect(history.processResult?.matching.experience_match.years_actual).toBeNull()
})

test('提交回执与基线revision在API边界保持完整', async () => {
  const post = jest.spyOn(apiClient, 'post').mockResolvedValue({...record, commit_ack: {commit_id: 'commit-one', document_id: 'document', revision: 2}})
  const history = {id: 'history', position: '产品经理', company: '公司', name: '', createdAt: '2026-11-12', qualityScore: 80, matchScore: null,
    tags: [], resumeContent: '源文', jdContent: '岗位', optimizedContent: generated.optimized.optimized_resume,
    processResult: generated, completionCommit: {commitId: 'commit-one', expectedDocument: {documentId: 'document', revision: 1, resolvedDigest: 'resolved'}}}
  const saved = await resumeHistoryApi.saveHistory(history)
  expect(post).toHaveBeenCalledWith('/resume-history', expect.objectContaining({commit_id: 'commit-one',
    expected_document: {documentId: 'document', revision: 1, resolvedDigest: 'resolved'}}))
  expect(saved.commitAck).toEqual({commit_id: 'commit-one', document_id: 'document', revision: 2})
})


test('旧文档升级携带确切旧版本摘要，并返回归一化的完整历史', async () => {
  const document = generated.optimized.completion_document!
  const post = jest.spyOn(apiClient, 'post').mockResolvedValue(record)
  const upgraded = await resumeHistoryApi.upgradeCompletion('history/with space', document)
  expect(post).toHaveBeenCalledWith('/resume-history/history%2Fwith%20space/completion-upgrade', {
    expected_document: {documentId: document.documentId, revision: document.revision, digest: actionContentDigest(document)},
  }, {header: {'X-Reffo-Completion-Schema': 'resume-completion-v4'}})
  expect(upgraded.processResult?.matching.skill_match.matched_skills).toEqual(['需求分析'])
})
