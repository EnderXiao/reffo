import {applyCompletionCommand, COMPLETION_TEMPLATES, createCompletionDocument, replayCompletionOperation, serializeDraft,
  type CompletionEditJournal, type CompletionOperation, type ResumeCompletionDocument} from '@/shared/resume-completion'
import type {ProcessResult, ResumeHistory} from '@/types'
import {resumeHistoryApi} from '@/services/resumeHistory'
import {sourceResumeApi} from '@/services/sourceResume'
import {feedback} from '../feedback'
import {getJSON, setJSON, storage} from '../storage'
import {HISTORY_STORAGE_KEY, LATEST_RESULT_SESSION_KEY} from '../user-data-storage'
import {PENDING_LANDING_HISTORIES_KEY, syncPendingLandingData} from '../pending-landing-data'
import type {LatestResultSession} from '../result-session'

jest.mock('@/services/resumeHistory', () => ({resumeHistoryApi: {getHistories: jest.fn(), saveHistory: jest.fn()}}))
jest.mock('@/services/sourceResume', () => ({sourceResumeApi: {getLatestSourceResume: jest.fn(), saveSourceResume: jest.fn()}}))
jest.mock('../feedback', () => ({feedback: {modal: jest.fn()}}))
jest.mock('../storage', () => ({getJSON: jest.fn(), setJSON: jest.fn(), storage: {removeItem: jest.fn()}}))

const values = new Map<string, unknown>()
const clone = <T,>(value: T): T => value == null ? value : JSON.parse(JSON.stringify(value)) as T

function fixture() {
  return createCompletionDocument({schemaVersion: 'resume-completion-v2', documentId: 'landing-document', blocks: [
    {blockId: 'row', kind: 'bullet', prefix: '- ', segments: [
      {kind: 'text', segmentId: 'start', markdown: '主导用户研究', origin: 'generated'},
      {kind: 'optional_gap_clause', gapId: 'a', detailId: 'detail-a', template: 'design_deliverable',
        ...COMPLETION_TEMPLATES.design_deliverable, candidates: [], retainedFacts: [], fill: {state: 'empty'}},
      {kind: 'text', segmentId: 'middle', markdown: '，推进需求评审', origin: 'generated'},
      {kind: 'optional_gap_clause', gapId: 'b', detailId: 'detail-b', template: 'method',
        ...COMPLETION_TEMPLATES.method, candidates: [], retainedFacts: [], fill: {state: 'empty'}},
      {kind: 'text', segmentId: 'end', markdown: '。', origin: 'generated'},
    ]},
  ]})
}

function fill(document: ResumeCompletionDocument, gapId: string, value: string) {
  const changed = applyCompletionCommand(document, {documentId: document.documentId, baseRevision: document.revision,
    type: 'fill', gapId, value})
  if (!changed.ok || !changed.operation) throw new Error('fixture edit failed')
  return {document: changed.document, operation: changed.operation}
}

function history(document: ResumeCompletionDocument, operations: CompletionOperation[] = [], baseRevision = 0): ResumeHistory {
  const result: ProcessResult = {
    analysis: {quality_score: 80, strengths: [], weaknesses: [], suggestions: [], capability_summary: '', structured_resume: {
      personal_info: {name: '测试用户'}, education: [], experience: [], projects: [], skills: {hard_skills: [], soft_skills: []}}},
    matching: {match_score: 80, hard_requirements_match: [], optimization_suggestions: [],
      skill_match: {matched_skills: [], missing_skills: [], match_percentage: 80},
      experience_match: {years_required: 0, years_actual: 0, relevant_experience: [], match_percentage: 80}},
    optimized: {optimized_resume: serializeDraft(document), completion_document: document, completion_context: 'a'.repeat(64),
      changes_summary: [], improvement_score: 0, ...(operations.length ? {completion_edit: {documentId: document.documentId, baseRevision, operations}} : {})},
    interview: {questions: [], story_recommendations: [], follow_up_questions: []},
  }
  return {id: 'pending-history', name: '测试用户', position: '产品经理', company: '公司', createdAt: '2026-11-10',
    qualityScore: 80, matchScore: 80, tags: [], resumeContent: '源简历', jdContent: '目标岗位',
    optimizedContent: result.optimized.optimized_resume, processResult: result,
    resultContext: {position: '产品经理', company: '公司', resumeContent: '源简历', jdContent: '目标岗位', presetJdId: 'preset-product'}}
}

function session(next: ResumeHistory, prior?: ResumeHistory): LatestResultSession {
  return {result: next.processResult!, context: next.resultContext!, sessionSequence: 2, originHistoryId: prior?.id,
    ...(prior ? {baseHistorySnapshot: {optimizedContent: prior.optimizedContent,
      completionDocument: prior.processResult?.optimized.completion_document}} : {})}
}

function replayToTarget(base: ResumeCompletionDocument, journal: CompletionEditJournal, target: ResumeCompletionDocument) {
  expect(journal.baseRevision).toBe(base.revision)
  let replayed = base
  for (const operation of journal.operations) {
    const change = replayCompletionOperation(replayed, operation)
    if (!change.ok) throw new Error('saved journal cannot replay')
    replayed = change.document
  }
  expect(replayed).toEqual(target)
}

beforeEach(() => {
  jest.clearAllMocks()
  values.clear()
  jest.mocked(getJSON).mockImplementation(async key => clone(values.get(key) ?? null))
  jest.mocked(setJSON).mockImplementation(async (key, value) => {values.set(key, clone(value))})
  jest.mocked(storage.removeItem).mockImplementation(async key => {values.delete(key)})
  jest.mocked(sourceResumeApi.getLatestSourceResume).mockResolvedValue(null)
  jest.mocked(resumeHistoryApi.getHistories).mockResolvedValue([])
  jest.mocked(resumeHistoryApi.saveHistory).mockImplementation(async input => input)
  jest.mocked(feedback.modal).mockImplementation(options => {options.onConfirm?.()})
})

describe('Landing 登录同步保留最新填写', () => {
  test('登录同步源简历保留上传 OCR 来源，清理本地暂存后仍能追踪', async () => {
    const parseId = '33333333-3333-4333-8333-333333333333'
    values.set('reffo.landing.pendingSourceResume', {id: 'landing-source', title: '源简历', resumeMarkdown: '# 候选人',
      sourceType: 'file', parseId, originalFileName: 'resume.pdf', createdAt: '2026-11-12', updatedAt: '2026-11-12'})
    await syncPendingLandingData()
    expect(sourceResumeApi.saveSourceResume).toHaveBeenCalledWith(expect.objectContaining({parse_id: parseId, source_type: 'file'}))
    expect(values.has('reffo.landing.pendingSourceResume')).toBe(false)
  })

  test.each([true, false])('pending rev1 合并最新 rev2 并保留 ID 与完整 journal，origin=%s', async useOrigin => {
    const baseline = fixture()
    const a = fill(baseline, 'a', '需求原型')
    const b = fill(a.document, 'b', '优先级评估')
    const pending = history(a.document, [a.operation])
    const latest = session(history(b.document, [a.operation, b.operation]), useOrigin ? pending : undefined)
    values.set(PENDING_LANDING_HISTORIES_KEY, [pending])
    values.set(LATEST_RESULT_SESSION_KEY, latest)

    await syncPendingLandingData()

    expect(resumeHistoryApi.saveHistory).toHaveBeenCalledTimes(1)
    const saved = jest.mocked(resumeHistoryApi.saveHistory).mock.calls[0][0]
    expect(saved.id).toBe(pending.id)
    expect(saved.createdAt).toBe(pending.createdAt)
    expect(saved.optimizedContent).toContain('优先级评估')
    expect(saved.processResult?.optimized.completion_context).toBe('a'.repeat(64))
    replayToTarget(baseline, saved.processResult!.optimized.completion_edit!, b.document)
    expect(values.has(PENDING_LANDING_HISTORIES_KEY)).toBe(false)
    expect(values.has(LATEST_RESULT_SESSION_KEY)).toBe(false)
  })

  test('最新会话只有后续 journal 时接上 pending 的未同步前缀', async () => {
    const baseline = fixture()
    const a = fill(baseline, 'a', '需求原型')
    const b = fill(a.document, 'b', '优先级评估')
    const pending = history(a.document, [a.operation])
    values.set(PENDING_LANDING_HISTORIES_KEY, [pending])
    values.set(LATEST_RESULT_SESSION_KEY, session(history(b.document, [b.operation], 1), pending))
    await syncPendingLandingData()
    const saved = jest.mocked(resumeHistoryApi.saveHistory).mock.calls[0][0]
    replayToTarget(baseline, saved.processResult!.optimized.completion_edit!, b.document)
  })

  test('中途失败后已有远端 rev1 时仅重放 rev2 的后续编辑', async () => {
    const baseline = fixture()
    const a = fill(baseline, 'a', '需求原型')
    const b = fill(a.document, 'b', '优先级评估')
    const pending = history(a.document, [a.operation])
    const remote = history(a.document)
    values.set(PENDING_LANDING_HISTORIES_KEY, [pending])
    values.set(LATEST_RESULT_SESSION_KEY, session(history(b.document, [a.operation, b.operation]), pending))
    jest.mocked(resumeHistoryApi.getHistories).mockResolvedValue([remote])
    await syncPendingLandingData()
    const saved = jest.mocked(resumeHistoryApi.saveHistory).mock.calls[0][0]
    expect(saved.id).toBe(remote.id)
    expect(saved.processResult!.optimized.completion_edit!.operations).toEqual([b.operation])
    replayToTarget(a.document, saved.processResult!.optimized.completion_edit!, b.document)
    expect(values.has(LATEST_RESULT_SESSION_KEY)).toBe(false)
  })

  test.each(['cancel', 'remote-conflict', 'local-conflict', 'preset-conflict', 'failed-save'])('%s 不删除尚未同步的填写草稿', async reason => {
    const baseline = fixture()
    const a = fill(baseline, 'a', '需求原型')
    const b = fill(a.document, 'b', '优先级评估')
    const pending = history(a.document, [a.operation])
    const latest = session(history(b.document, [a.operation, b.operation]), pending)
    values.set(PENDING_LANDING_HISTORIES_KEY, [pending])
    values.set(LATEST_RESULT_SESSION_KEY, latest)
    if (reason === 'cancel') jest.mocked(feedback.modal).mockImplementation(options => {options.onCancel?.()})
    if (reason === 'remote-conflict') {
      const conflicting = fill(baseline, 'a', '远端独立编辑')
      jest.mocked(resumeHistoryApi.getHistories).mockResolvedValue([history(conflicting.document)])
    }
    if (reason === 'local-conflict') {
      const conflicting = fill(baseline, 'a', '另一个本地版本')
      values.set(PENDING_LANDING_HISTORIES_KEY, [history(conflicting.document, [conflicting.operation])])
    }
    if (reason === 'preset-conflict') {
      const other = createCompletionDocument({...baseline, documentId: 'other-document'})
      jest.mocked(resumeHistoryApi.getHistories).mockResolvedValue([{...history(other), id: 'other-history'}])
    }
    if (reason === 'failed-save') jest.mocked(resumeHistoryApi.saveHistory).mockRejectedValueOnce(new Error('offline'))
    if (reason === 'failed-save') await expect(syncPendingLandingData()).rejects.toThrow('offline')
    else await syncPendingLandingData()
    expect(values.has(PENDING_LANDING_HISTORIES_KEY)).toBe(true)
    expect(values.get(LATEST_RESULT_SESSION_KEY)).toEqual(latest)
  })

  test('请求期间发生的新填写保留在匿名最新会话中', async () => {
    const baseline = fixture()
    const a = fill(baseline, 'a', '需求原型')
    const b = fill(a.document, 'b', '优先级评估')
    const c = fill(b.document, 'b', '新的实际方法')
    const pending = history(a.document, [a.operation])
    const next = session(history(c.document, [a.operation, b.operation, c.operation]), pending)
    next.sessionSequence = 3
    values.set(PENDING_LANDING_HISTORIES_KEY, [pending])
    values.set(LATEST_RESULT_SESSION_KEY, session(history(b.document, [a.operation, b.operation]), pending))
    jest.mocked(resumeHistoryApi.saveHistory).mockImplementation(async input => {values.set(LATEST_RESULT_SESSION_KEY, next); return input})
    await syncPendingLandingData()
    expect(values.get(LATEST_RESULT_SESSION_KEY)).toEqual(next)
  })

  test.each(['local', 'remote'])('%s 同字段同 revision 的不同分支不被后续编辑覆盖', async branch => {
    const baseline = fixture()
    const a = fill(baseline, 'a', '本地方案A')
    const changedAgain = fill(a.document, 'a', '本地方案C')
    const competing = fill(baseline, 'a', '另一分支B')
    const pending = history(a.document, [a.operation])
    const latest = session(history(changedAgain.document, [a.operation, changedAgain.operation]), pending)
    values.set(PENDING_LANDING_HISTORIES_KEY, branch === 'local'
      ? [history(competing.document, [competing.operation])] : [pending])
    values.set(LATEST_RESULT_SESSION_KEY, latest)
    if (branch === 'remote') jest.mocked(resumeHistoryApi.getHistories).mockResolvedValue([history(competing.document)])
    await syncPendingLandingData()
    expect(resumeHistoryApi.saveHistory).not.toHaveBeenCalled()
    expect(values.has(PENDING_LANDING_HISTORIES_KEY)).toBe(true)
    expect(values.get(LATEST_RESULT_SESSION_KEY)).toEqual(latest)
  })

  test('远端已精确保存本地快照时去重，不重复提交', async () => {
    const pending = history(fixture())
    values.set(HISTORY_STORAGE_KEY, [pending])
    values.set(LATEST_RESULT_SESSION_KEY, session(pending, pending))
    jest.mocked(resumeHistoryApi.getHistories).mockResolvedValue([pending])
    await syncPendingLandingData()
    expect(resumeHistoryApi.saveHistory).not.toHaveBeenCalled()
    expect(values.has(HISTORY_STORAGE_KEY)).toBe(false)
    expect(values.has(LATEST_RESULT_SESSION_KEY)).toBe(false)
  })
})
