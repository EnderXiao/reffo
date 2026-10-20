import {test, expect} from 'bun:test'
import {
  publishGenerationJobUpdate,
  subscribeGenerationJobUpdates,
} from '@/services/generation-job-events'
import type {GenerationJob} from '@/types/generation-job'

function createJob(userId: string): GenerationJob {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    user_id: userId,
    status: 'running',
    stage: 'analysis',
    background: true,
    read_at: null,
    confirmed_at: null,
    history_id: null,
    error: null,
    created_at: '2026-10-14T00:00:00.000Z',
    updated_at: '2026-10-14T00:00:01.000Z',
    lease_token: 'lease',
    lease_expires_at: '2026-10-14T00:01:00.000Z',
    quota_charged: true,
    payload: {
      input: {
        resume_markdown: '# resume',
        jd_text: '# jd',
        company: 'Reffo',
        position: '产品经理',
        location: '上海',
      },
    },
  }
}

test('生成任务事件只发送给任务所属用户', () => {
  const events: string[] = []
  const unsubscribe = subscribeGenerationJobUpdates(event => {
    events.push(`${event.userId}:${event.job.id}:${event.job.status}`)
  })

  publishGenerationJobUpdate(createJob('user-1'))
  publishGenerationJobUpdate(createJob('user-2'))

  expect(events).toEqual([
    'user-1:00000000-0000-0000-0000-000000000001:running',
    'user-2:00000000-0000-0000-0000-000000000001:running',
  ])
  unsubscribe()
})
