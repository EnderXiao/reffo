import { describe, expect, test } from 'bun:test'
import {
  buildShareSnapshot,
  ShareHistoryIncompleteError,
} from '@/shared/share-link-snapshot'
import type { ResumeHistoryRecord } from '@/types'

function createHistory(): ResumeHistoryRecord {
  return {
    id: 'JD2026102500001',
    position: 'AI Product Manager',
    company: 'Echo',
    name: 'Jeremy Smith',
    created_at: '2025-12-15T10:00:00.000Z',
    updated_at: '2025-12-15T10:00:00.000Z',
    quality_score: 86,
    match_score: 88,
    tags: ['AI'],
    resume_content: 'private resume content',
    jd_content: '工作地点：北京\nprivate jd content',
    optimized_content: '## 强调效率提升\n\n突出复杂项目经验。',
    result_context: {
      company: 'Echo',
      position: 'AI Product Manager',
      location: '北京',
      resumeContent: 'private resume content',
      jdContent: 'private jd content',
    },
  }
}

describe('buildShareSnapshot', () => {
  test('builds a job snapshot without private history fields', () => {
    const snapshot = buildShareSnapshot(createHistory(), 'job')

    expect(snapshot).toMatchObject({
      schema_version: 1,
      mode: 'job',
      theme: 'green',
      card: {
        kind: 'job',
        display_name: 'Jeremy Smith',
        company: 'Echo',
        position: 'AI Product Manager',
        location: '北京',
        match_score: 88,
      },
    })
    expect(JSON.stringify(snapshot)).not.toContain('private resume content')
    expect(JSON.stringify(snapshot)).not.toContain('private jd content')
  })

  test('builds a fully generic blank snapshot', () => {
    const snapshot = buildShareSnapshot(createHistory(), 'blank')

    expect(snapshot).toMatchObject({
      mode: 'blank',
      theme: 'blue',
      card: {
        kind: 'blank',
        title: '新的申请',
        prompt: '从描述你的目标岗位',
        action: '开始',
      },
    })
    expect(JSON.stringify(snapshot)).not.toContain('Echo')
    expect(JSON.stringify(snapshot)).not.toContain('Jeremy Smith')
    expect(JSON.stringify(snapshot)).not.toContain('AI Product Manager')
    expect(JSON.stringify(snapshot)).not.toContain('88')
  })

  test('rejects incomplete job information', () => {
    const history = createHistory()
    history.company = '--'

    expect(() => buildShareSnapshot(history, 'job')).toThrow(ShareHistoryIncompleteError)
    expect(() => buildShareSnapshot(history, 'blank')).not.toThrow()
  })
})
