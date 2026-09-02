import { env } from '@/config/env'
import { createHarnessEventBus, type HarnessEventBus } from '@/harness/event-bus'
import { logHarnessEvent } from '@/harness/subscribers/log-subscriber'
import { PersistenceSubscriber } from '@/harness/subscribers/persistence-subscriber'
import { TraceSubscriber } from '@/harness/subscribers/trace-subscriber'
import type { MvpProcessResponse } from '@/types'
import { toLegacyMvpProcessResponse } from '@/v5/main/compatibility'
import { V5ResumeOptimizationWorkflow } from '@/v5/main/workflow'

export interface ResumeOptimizationWorkflowInput {
  resume_markdown: string
  jd_text: string
  workflowTimeoutMs?: number
  enable_llm_judge?: boolean
  output_language?: string
}

export interface ResumeOptimizationWorkflowOptions {
  enableDefaultSubscribers?: boolean
  v5Runner?: (input: ResumeOptimizationWorkflowInput) => Promise<MvpProcessResponse>
}

export class ResumeOptimizationWorkflow {
  private readonly eventBus: HarnessEventBus
  private readonly v5Runner?: (input: ResumeOptimizationWorkflowInput) => Promise<MvpProcessResponse>
  private readonly traceSubscriber = new TraceSubscriber()
  private readonly persistenceSubscriber = new PersistenceSubscriber()

  constructor(
    eventBus: HarnessEventBus = createHarnessEventBus(),
    options: ResumeOptimizationWorkflowOptions = {}
  ) {
    this.eventBus = eventBus
    this.v5Runner = options.v5Runner

    if (options.enableDefaultSubscribers !== false) {
      this.eventBus.subscribe('*', this.traceSubscriber.handle)
      this.eventBus.subscribe('*', this.persistenceSubscriber.handle)
      this.eventBus.subscribe('*', logHarnessEvent)
    }
  }

  async run(input: ResumeOptimizationWorkflowInput): Promise<MvpProcessResponse> {
    if (this.v5Runner) return this.v5Runner(input)

    const workflow = new V5ResumeOptimizationWorkflow({
      eventBus: this.eventBus,
      enableDefaultSubscribers: false,
    })
    const result = await workflow.run({
      resumeMarkdown: input.resume_markdown,
      jobDescription: input.jd_text,
      outputLanguage: input.output_language,
      enableQualityJudge: input.enable_llm_judge ?? env.V5_QUALITY_JUDGE_ENABLED,
      workflowTimeoutMs: input.workflowTimeoutMs,
    })
    return toLegacyMvpProcessResponse(result)
  }
}
