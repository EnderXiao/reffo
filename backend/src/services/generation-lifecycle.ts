type GenerationLifecycleEvent = 'accepted' | 'claimed' | 'resume_saved' | 'history_readable' | 'generation_failed'
  | 'interview_ready' | 'interview_failed' | 'interview_stale'

export function recordGenerationLifecycle(event: GenerationLifecycleEvent, fields: {
  jobId?: string; historyId?: string; runId?: string; code?: string; durationMs?: number
}) {
  console.info(JSON.stringify({event: `resume_generation.${event}`, occurredAt: new Date().toISOString(), ...fields}))
}
