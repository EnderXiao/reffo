import {expect, test} from 'bun:test'
import {observeGeneration, reportGenerationComparison} from '../../../scripts/compare-generation-jobs'

const fixture = {id: 'ops-assistant', resume_markdown: '参与客服问题分类，整理每周反馈。', jd_text: '负责客服数据跟踪和日常反馈整理。'}
const client = {baseUrl: new URL('http://localhost:3000/api/v1/'), timeoutMs: 1000, pollMs: 1}

function payload(data: unknown) {
  return Response.json({success: true, data})
}

test('records a readable resume independently of a failed background interview', async () => {
  let requestId = ''
  let lookups = 0
  const captures: string[] = []
  const result = await observeGeneration({...client, async fetch(url, options) {
    if (options?.method === 'POST') {
      requestId = JSON.parse(String(options.body)).request_id
      return payload({id: requestId, status: 'running'})
    }
    if (url.pathname.endsWith(requestId)) return payload({id: requestId, status: 'completed', history_id: 'JD-1'})
    lookups += 1
    return payload({optimized_content: '# 简历', process_result: {optimized: {optimized_resume: '# 简历'}},
      progress: {interview: 'pending'}, interview_task: {status: lookups === 1 ? 'pending' : 'failed'}})
  }}, fixture, 'candidate', 'cold', markdown => captures.push(markdown))

  expect(result).toMatchObject({resume: 'readable', interview: 'failed', failureCode: 'INTERVIEW_FAILED', interviewReadyMs: null})
  expect(result.acceptedMs).not.toBeNull()
  expect(result.runningObservedMs).not.toBeNull()
  expect(result.readableMs).not.toBeNull()
  expect(captures).toEqual(['# 简历'])
})

test('keeps failed and timed-out attempts in the denominator and pairs only readable samples', async () => {
  const failed = await observeGeneration({...client, async fetch(_url, options) {
    const id = JSON.parse(String(options?.body)).request_id
    return payload({id, status: 'failed', failure: {code: 'GENERATION_FAILED'}})
  }}, fixture, 'baseline', 'cold')
  const timedOut = await observeGeneration({...client, timeoutMs: 20, async fetch(_url, options) {
    while (!options?.signal?.aborted) await Bun.sleep(2)
    throw options.signal.reason
  }}, {...fixture, id: 'another-fixture'}, 'baseline', 'cold')
  const delivered = await observeGeneration({...client, async fetch(_url, options) {
    if (options?.method === 'POST') {
      const id = JSON.parse(String(options.body)).request_id
      return payload({id, status: 'completed', history_id: 'JD-2'})
    }
    return payload({optimized_content: '# 简历', process_result: {optimized: {optimized_resume: '# 简历'}, interview: {items: []}},
      progress: {interview: 'done'}})
  }}, fixture, 'candidate', 'cold')

  expect(delivered.interview).toBe('done')
  expect(reportGenerationComparison([failed, timedOut, delivered]).cold).toMatchObject({
    baseline: {attempted: 2, accepted: 1, resumeFailureRate: 1, resume: {readable: 0, failed: 1, timeout: 1}, readableLatency: {observed: 0, p95Ms: null}},
    candidate: {attempted: 1, accepted: 1, resumeFailureRate: 0, resume: {readable: 1, failed: 0, timeout: 0}},
    pairedReadableDelta: {paired: 0, p95Ms: null},
  })
  const deliveredBaseline = {...delivered, fixtureId: 'readable-fixture', variant: 'baseline' as const}
  expect(reportGenerationComparison([failed, timedOut, deliveredBaseline]).cold.baseline).toMatchObject({
    readableLatency: {observed: 1, p95Ms: deliveredBaseline.readableMs},
    acceptedToReadableWithinDeadline: {observed: 1, accepted: 2, p50Ms: deliveredBaseline.readableMs, p95Ms: null},
  })
})
