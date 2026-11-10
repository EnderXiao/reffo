import {applyCompletionCommand, createPlainCompletionDocument} from '@/shared/resume-completion'
import type {ResumeHistory} from '@/types'
import type {LatestResultSession} from '@/utils/result-session'
import {completionFixture, completionResult} from './completionFixture'
import {historyCompletionBaseline, resolveHistorySession, sameCompletionState} from '../model/completionSession'

function historyFixture(): ResumeHistory {
  const result = completionResult()
  return {id: 'history', name: '测试用户', position: '产品经理', company: '测试公司', createdAt: '2026-11-10', qualityScore: 80,
    matchScore: 80, tags: [], resumeContent: '# 源简历', jdContent: '岗位职责', optimizedContent: result.optimized.optimized_resume, processResult: result}
}

function editedSession(history: ResumeHistory): LatestResultSession {
  const document = completionFixture()
  const changed = applyCompletionCommand(document, {documentId: document.documentId, baseRevision: 0, gapId: 'deliverable', type: 'fill', value: '页面原型'})
  if (!changed.ok) throw new Error('fixture failed')
  return {result: completionResult(changed.document), context: {company: '测试公司', position: '产品经理', resumeContent: '# 源简历', jdContent: '岗位职责'},
    originHistoryId: history.id, baseHistorySnapshot: historyCompletionBaseline(history)}
}

describe('填写会话与历史恢复', () => {
  test('本地编辑只恢复到自己的历史，双方变化时保留冲突', () => {
    const history = historyFixture()
    const session = editedSession(history)
    expect(resolveHistorySession(history, history.processResult!, session)).toBe('session')
    expect(resolveHistorySession({...history, id: 'other'}, history.processResult!, session)).toBe('history')
    const remoteResult = completionResult(createPlainCompletionDocument('# 远端更新'))
    expect(resolveHistorySession({...history, optimizedContent: remoteResult.optimized.optimized_resume, processResult: remoteResult}, remoteResult, session)).toBe('conflict')
  })

  test('正文相同但空位状态不同，不能假装同一历史快照', () => {
    const history = historyFixture()
    const session = editedSession(history)
    const plain = completionResult(createPlainCompletionDocument(session.result.optimized.optimized_resume))
    expect(sameCompletionState(plain.optimized, session.result.optimized)).toBe(false)
    expect(resolveHistorySession({...history, optimizedContent: plain.optimized.optimized_resume, processResult: plain}, plain, session)).toBe('conflict')
  })

  test('历史已与会话完全相同，恢复为已保存；外观更新时间不造成冲突', () => {
    const history = historyFixture()
    const session = editedSession(history)
    expect(resolveHistorySession({...history, updatedAt: '2030-01-01'}, history.processResult!, session)).toBe('session')
    expect(resolveHistorySession({...history, optimizedContent: session.result.optimized.optimized_resume, processResult: session.result}, session.result, session)).toBe('history')
  })
})
