import type {GenerationJob, GenerationJobPayload} from '@/types/generation-job'
import {resumeStageFingerprint} from '@/v5/stage-fingerprints'

const stageFields=[['extraction','analysis'],['matching','matching'],['generation','optimized'],['interview','interview']] as const
export function currentGenerationStageFingerprints() {return Object.fromEntries(stageFields.map(([stage])=>[stage,resumeStageFingerprint(stage)])) as NonNullable<GenerationJobPayload['stageFingerprints']>}

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

export function withoutGenerationFailure(payload: GenerationJobPayload): GenerationJobPayload {
  if (!payload.failure) return payload
  const {failure: _failure, ...current} = payload
  return current
}

export function assertGenerationJobVersion(payload: GenerationJobPayload, fingerprint: string) {
  if (payload.stageFingerprints) {
    for (const [stage,field] of stageFields) if(payload[field] && payload.stageFingerprints[stage]!==resumeStageFingerprint(stage)) throw new GenerationJobVersionError()
    return
  }
  // Completed payloads can finish their durable save without mixing model releases.
  if (hasGenerationStages(payload) && !hasCompletedGeneration(payload)
    && payload.releaseFingerprint !== fingerprint) throw new GenerationJobVersionError()
}

/** Only the explicit retry action may discard incompatible intermediate checkpoints. */
export function generationJobRetryChanges(job: GenerationJob, fingerprint: string, now: string): Partial<GenerationJob> {
  if (job.payload.stageFingerprints) {
    const firstInvalid=stageFields.findIndex(([stage,field])=>!!job.payload[field] && job.payload.stageFingerprints?.[stage]!==resumeStageFingerprint(stage))
    if(firstInvalid>=0) {
      const payload={...withoutGenerationFailure(job.payload),releaseFingerprint:fingerprint,stageFingerprints:currentGenerationStageFingerprints()}
      for(const [,field]of stageFields.slice(firstInvalid))delete payload[field]
      return {status:'queued',error:null,lease_token:null,lease_expires_at:now,stage:stageFields[firstInvalid]![1],payload}
    }
    return {status:'queued',error:null,lease_token:null,lease_expires_at:now,
      ...(job.payload.failure ? {payload:withoutGenerationFailure(job.payload)} : {})}
  }
  const reset = job.payload.releaseFingerprint !== fingerprint && !hasCompletedGeneration(job.payload)
  return {
    status: 'queued', error: null, lease_token: null, lease_expires_at: now,
    ...(reset ? {stage: 'analysis', payload: {input: job.payload.input, releaseFingerprint: fingerprint}}
      : job.payload.failure ? {payload: withoutGenerationFailure(job.payload)} : {}),
  }
}
