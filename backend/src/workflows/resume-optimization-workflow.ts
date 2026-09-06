import { createHarnessEventBus, type HarnessEventBus } from '@/harness/event-bus'
import { env } from '@/config/env'
import { createDigest } from '@/harness/run-context'
import { logHarnessEvent } from '@/harness/subscribers/log-subscriber'
import { PersistenceSubscriber } from '@/harness/subscribers/persistence-subscriber'
import { TraceSubscriber } from '@/harness/subscribers/trace-subscriber'
import type { MvpProcessResponse } from '@/types'
import { toLegacyMvpProcessResponse } from '@/v5/main/compatibility'
import { V5ResumeOptimizationWorkflow } from '@/v5/main/workflow'
import { createTrustedResumeExtractionCache } from '@/v5/resume-extraction-cache'
import { V5_WORKFLOW_VERSION } from '@/v5/types'

const sharedResumeExtractionCache = createTrustedResumeExtractionCache({
  implementationFingerprint: V5_WORKFLOW_VERSION,
  providerConfigFingerprint: createDigest({
    provider: 'deepseek',
    baseUrl: env.OPENAI_BASE_URL,
    model: env.AI_MODEL,
    structuredOutputMode: env.V5_STRUCTURED_OUTPUT_MODE,
  }),
  maxEntries: 16,
})

export interface ResumeOptimizationWorkflowInput {
  resume_markdown: string
  jd_text: string
  workflowTimeoutMs?: number
  enable_llm_judge?: boolean
  output_language?: string
  onAnalysisSucceeded?: () => void | Promise<void>
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
      resumeExtractionCache: sharedResumeExtractionCache,
    })
    let analysisFailure: { error: unknown } | undefined
    try {
      const result = await workflow.run({
        resumeMarkdown: input.resume_markdown,
        jobDescription: input.jd_text,
        outputLanguage: input.output_language,
        // Compatibility flag only. Release is controlled by deterministic code
        // checks in v5 and no longer invokes an external judge.
        enableQualityJudge: false,
        workflowTimeoutMs: input.workflowTimeoutMs,
        onAnalysisSucceeded: async () => {
          try {
            await input.onAnalysisSucceeded?.()
          } catch (error) {
            analysisFailure = { error }
            throw error
          }
        },
      })
      return toLegacyMvpProcessResponse(result)
    } catch (error) {
      // Keep application errors (for example quota exhaustion) intact after V5 diagnostics.
      throw analysisFailure ? analysisFailure.error : error
    }
  }
}
