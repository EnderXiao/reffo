import type {v5SingleStepAdapter} from '@/v5/single-step-adapter'

export type GenerationJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type GenerationJobStage = 'analysis' | 'matching' | 'optimized' | 'interview' | 'saving'
export interface GenerationJobFailure {
  code: string
  stage: GenerationJobStage
  runId?: string
  issueCodes: string[]
  writingRecovery?: import('@/v5/writing/recovery-diagnostics').WritingRecoveryDiagnostics
  retryable: boolean
  action: string
  occurredAt: string
}
export interface GenerationJobInput {
  resume_markdown: string
  jd_text: string
  jd_parse_id?: string
  resume_parse_id?: string
  company: string
  position: string
  location: string
}
export interface GenerationJobPayload {
  input: GenerationJobInput
  releaseFingerprint?: string
  stageFingerprints?: Partial<Record<'extraction'|'matching'|'generation'|'interview',string>>
  traceRunIds?: Partial<Record<'analysis'|'matching'|'optimized'|'interview', string>>
  failure?: GenerationJobFailure
  analysis?: Awaited<ReturnType<typeof v5SingleStepAdapter.analyze>>['data']
  matching?: Awaited<ReturnType<typeof v5SingleStepAdapter.match>>['data']
  optimized?: Awaited<ReturnType<typeof v5SingleStepAdapter.generate>>['data']
  interview?: Awaited<ReturnType<typeof v5SingleStepAdapter.interview>>['data']
}
export interface GenerationJob {
  id: string
  user_id: string
  status: GenerationJobStatus
  stage: GenerationJobStage
  background: boolean
  read_at: string | null
  confirmed_at: string | null
  history_id: string | null
  error: string | null
  created_at: string
  updated_at: string
  lease_token: string | null
  lease_expires_at: string
  quota_charged: boolean
  payload: GenerationJobPayload
}
export type GenerationJobSummary = Omit<GenerationJob, 'user_id' | 'payload' | 'lease_token' | 'lease_expires_at' | 'quota_charged'> & {
  company: string
  position: string
  location: string
  score: number | null
  failure?: GenerationJobFailure
}
export function summarizeGenerationJob(job: GenerationJob): GenerationJobSummary {
  const {user_id, payload, lease_token, lease_expires_at, quota_charged, ...summary} = job
  const basic = payload.matching?.jd_structure?.basic_info
  return {...summary,
    company: payload.input.company || basic?.company || '目标公司',
    position: payload.input.position || basic?.title || '目标岗位',
    location: payload.input.location || basic?.location || '',
    score: payload.matching?.match_score ?? null,
    ...(payload.failure ? {failure: payload.failure} : {}),
  }
}
