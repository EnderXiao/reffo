import {describe, expect, test} from 'bun:test'
import {generationInputTrace, inputParseTrace} from './generation-input-trace'
import type {GenerationJob} from '@/types/generation-job'

const parseId = '11111111-1111-4111-8111-111111111111'
const runId = '22222222-2222-4222-8222-222222222222'
const job = {id: '33333333-3333-4333-8333-333333333333', payload: {input: {jd_parse_id: parseId,
  resume_markdown: '不应进入追踪的简历正文', jd_text: '不应进入追踪的岗位正文'}}} as GenerationJob

describe('OCR generation correlation', () => {
  test('only opaque IDs enter harness correlation metadata', () => {
    const trace = generationInputTrace(job, 'matching', runId)
    expect(trace).toEqual({version: 'ocr-generation-link-v1', jobId: job.id, jdParseId: parseId,
      stage: 'matching', runId, provenance: 'client_reference'})
    expect(JSON.stringify(trace)).not.toContain('正文')
  })
  test('manual JD and invalid references do not fabricate an OCR link', () => {
    expect(generationInputTrace({...job, payload: {...job.payload, input: {...job.payload.input, jd_parse_id: undefined}}}, 'matching', runId)).toBeUndefined()
    expect(generationInputTrace(job, 'matching', 'not-a-run')).toBeUndefined()
  })
  test('resume OCR remains traceable when the JD is manual and both references cross synchronous stages', () => {
    const resumeJob = {...job, payload: {...job.payload, input: {...job.payload.input, jd_parse_id: undefined, resume_parse_id: parseId}}}
    expect(generationInputTrace(resumeJob, 'analysis', runId)).toMatchObject({resumeParseId: parseId, stage: 'analysis'})
    expect(inputParseTrace({requestId: 'landing-request', jdParseId: parseId, resumeParseId: runId, stage: 'optimized_failed', runId}))
      .toMatchObject({jobId: 'landing-request', jdParseId: parseId, resumeParseId: runId, stage: 'optimized_failed', provenance: 'client_reference'})
    expect(inputParseTrace({requestId: 'manual-request', stage: 'analysis', runId})).toBeUndefined()
  })
})
