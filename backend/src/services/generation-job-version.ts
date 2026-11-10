import type {GenerationJob, GenerationJobPayload} from '@/types/generation-job'

export class GenerationJobVersionError extends Error {
  readonly code = 'GENERATION_VERSION_CHANGED'

  constructor() {
    super('生成服务已更新，请点击重试以使用当前版本重新生成，已扣次数不会重复扣除')
    this.name = 'GenerationJobVersionError'
  }
}

export function hasGenerationStages(payload: GenerationJobPayload) {
  return Boolean(payload.analysis || payload.matching || payload.optimized || payload.interview)
}

export function hasCompletedGeneration(payload: GenerationJobPayload) {
  return Boolean(payload.analysis && payload.matching && payload.optimized && payload.interview)
}

export function assertGenerationJobVersion(payload: GenerationJobPayload, fingerprint: string) {
  // Completed payloads can finish their durable save without mixing model releases.
  if (hasGenerationStages(payload) && !hasCompletedGeneration(payload)
    && payload.releaseFingerprint !== fingerprint) throw new GenerationJobVersionError()
}

/** Only the explicit retry action may discard incompatible intermediate checkpoints. */
export function generationJobRetryChanges(job: GenerationJob, fingerprint: string, now: string): Partial<GenerationJob> {
  const reset = job.payload.releaseFingerprint !== fingerprint && !hasCompletedGeneration(job.payload)
  return {
    status: 'queued', error: null, lease_token: null, lease_expires_at: now,
    ...(reset ? {stage: 'analysis', payload: {input: job.payload.input, releaseFingerprint: fingerprint}} : {}),
  }
}
