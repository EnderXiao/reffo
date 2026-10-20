import {summarizeGenerationJob, type GenerationJob} from '@/types/generation-job'

export interface GenerationJobUpdatedEvent {
  userId: string
  job: ReturnType<typeof summarizeGenerationJob>
}

type Listener = (event: GenerationJobUpdatedEvent) => void

const listeners = new Set<Listener>()

export function publishGenerationJobUpdate(job: GenerationJob) {
  const event: GenerationJobUpdatedEvent = {
    userId: job.user_id,
    job: summarizeGenerationJob(job),
  }

  listeners.forEach(listener => listener(event))
}

export function subscribeGenerationJobUpdates(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
