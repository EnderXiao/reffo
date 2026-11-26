import {describe, expect, test} from '@jest/globals'
import type {ResumeHistory} from '@/types'
import type {LatestResultSession} from '@/utils/result-session'
import {resolveHistorySession, resultSnapshotKey, sameCompletionState} from '../completionSession'

const history = {id: 'JD-1', optimizedContent: '', processResult: {analysis: {}} as never} as unknown as ResumeHistory

function session(overrides: Partial<LatestResultSession> = {}): LatestResultSession {
  return {
    result: {analysis: {}, matching: {}, optimized: {optimized_resume: 'x'}, interview: {questions: [], story_recommendations: [], follow_up_questions: []}} as never,
    context: {company: '', position: '', resumeContent: '', jdContent: ''},
    progress: {analysis: 'done', matching: 'done', optimized: 'done', interview: 'done'},
    originHistoryId: 'JD-1',
    baseHistorySnapshot: {optimizedContent: 'x'},
    ...overrides,
  } as LatestResultSession
}

describe('详情页会话恢复的空值兼容', () => {
  test('本地 session 缺少 optimized 时按历史处理，不抛错', () => {
    const broken = session()
    delete (broken.result as {optimized?: unknown}).optimized
    expect(() => resolveHistorySession(history, {optimized: {}} as never, broken)).not.toThrow()
    expect(resolveHistorySession(history, {optimized: {}} as never, broken)).toBe('history')
  })

  test('sameCompletionState 容忍 undefined 两侧', () => {
    expect(sameCompletionState(undefined, undefined)).toBe(true)
    expect(sameCompletionState({optimized_resume: 'a'}, undefined)).toBe(false)
  })

  test('resultSnapshotKey 在缺少 optimized 时不抛错', () => {
    expect(() => resultSnapshotKey({analysis: {}} as never)).not.toThrow()
  })
})
