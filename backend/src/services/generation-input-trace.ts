import {createHarnessEvent} from '@/harness/events'
import {createDigest} from '@/harness/run-context'
import {PersistenceSubscriber} from '@/harness/subscribers/persistence-subscriber'
import type {GenerationJob} from '@/types/generation-job'

const persistence = new PersistenceSubscriber()
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

export function inputParseTrace(input: {requestId: string; jdParseId?: string; resumeParseId?: string; stage: string; runId: unknown}) {
  const jdParseId = input.jdParseId && UUID.test(input.jdParseId) ? input.jdParseId : undefined
  const resumeParseId = input.resumeParseId && UUID.test(input.resumeParseId) ? input.resumeParseId : undefined
  if ((!jdParseId && !resumeParseId) || typeof input.runId !== 'string' || !UUID.test(input.runId)) return undefined
  return {version: 'ocr-generation-link-v1' as const, jobId: input.requestId, ...(jdParseId ? {jdParseId} : {}), ...(resumeParseId ? {resumeParseId} : {}), stage: input.stage, runId: input.runId,
    provenance: 'client_reference' as const}
}
export function generationInputTrace(job: GenerationJob, stage: string, runId: unknown) {
  return inputParseTrace({requestId: job.id, jdParseId: job.payload.input.jd_parse_id, resumeParseId: job.payload.input.resume_parse_id, stage, runId})
}

/** Correlation metadata only; neither OCR text nor candidate facts enter diagnostics. */
export async function persistGenerationInputTrace(job: GenerationJob, stage: string, runId: unknown) {
  return persistInputParseTrace({requestId: job.id, jdParseId: job.payload.input.jd_parse_id, resumeParseId: job.payload.input.resume_parse_id, stage, runId})
}
export async function persistInputParseTrace(input: Parameters<typeof inputParseTrace>[0]) {
  const trace = inputParseTrace(input)
  if (!trace) return
  try {
    await persistence.handle(createHarnessEvent({type: 'output.parsed', runId: trace.runId, requestId: input.requestId,
      payload: {outputName: 'OcrGenerationLink', outputDigest: createDigest(trace), summary: JSON.stringify(trace)}}))
  } catch {console.error('[OcrGenerationLink] 输入关联诊断暂未持久化')}
}
