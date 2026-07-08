import { createHarnessEventBus, type HarnessEventBus } from '@/harness/event-bus'
import { createHarnessEvent } from '@/harness/events'
import { createDigest, createRunContext } from '@/harness/run-context'
import { runStep, StepRunError, type StepRunSnapshot } from '@/harness/run-step'
import { logHarnessEvent } from '@/harness/subscribers/log-subscriber'
import { PersistenceSubscriber } from '@/harness/subscribers/persistence-subscriber'
import { TraceSubscriber } from '@/harness/subscribers/trace-subscriber'
import { glmOcrProvider } from '@/services/ocr/glm-ocr-provider'
import type { OcrProvider, ParsedDocumentResult, ParseDocumentInput } from '@/services/ocr/types'

export interface OcrParseWorkflowResult extends ParsedDocumentResult {
  run_id: string
  step_statuses: StepRunSnapshot[]
}

export class OcrParseWorkflow {
  private readonly eventBus: HarnessEventBus
  private readonly traceSubscriber = new TraceSubscriber()
  private readonly persistenceSubscriber = new PersistenceSubscriber()

  constructor(
    eventBus: HarnessEventBus = createHarnessEventBus(),
    private readonly provider: OcrProvider = glmOcrProvider
  ) {
    this.eventBus = eventBus
    this.eventBus.subscribe('*', this.traceSubscriber.handle)
    this.eventBus.subscribe('*', this.persistenceSubscriber.handle)
    this.eventBus.subscribe('*', logHarnessEvent)
  }

  async run(input: ParseDocumentInput): Promise<OcrParseWorkflowResult> {
    const runContext = createRunContext(`ocr:v1:${input.purpose}`, 'ocr_document_parse')
    const steps: StepRunSnapshot[] = []

    await this.publishWorkflowStatus('workflow.started', runContext.runId, runContext.requestId, {
      workflowName: 'ocr_document_parse',
      workflowVersion: runContext.workflowVersion,
      inputDigest: createDigest({
        fileName: input.fileName,
        mimeType: input.mimeType,
        fileType: input.fileType,
        purpose: input.purpose,
        byteLength: input.buffer.byteLength,
      }),
    })

    try {
      const parseStep = await runStep({
        runContext,
        eventBus: this.eventBus,
        stepName: input.purpose === 'jobDescription' ? 'parse_jd_image_ocr' : 'parse_resume_file_ocr',
        timeoutMs: undefined,
        execute: async (stepContext) => {
          const result = await this.provider.parseDocument({
            ...input,
            signal: stepContext.signal,
          }, {
            eventBus: this.eventBus,
            stepContext,
          })

          await this.eventBus.publish(createHarnessEvent({
            type: 'output.parsed',
            runId: stepContext.runId,
            requestId: stepContext.requestId,
            stepRunId: stepContext.stepRunId,
            attemptId: stepContext.attemptId,
            payload: {
              outputName: input.purpose === 'jobDescription' ? 'ParsedJobDescriptionResult' : 'ParsedDocumentResult',
              outputDigest: createDigest({
                rawText: result.rawText,
                markdown: result.markdown,
                structured: result.structured,
              }),
              summary: JSON.stringify({
                provider: result.provider,
                fileName: result.fileName,
                fileType: result.fileType,
                purpose: input.purpose,
                rawTextLength: result.rawText.length,
                warningCount: result.warnings.length,
              }),
            },
          }))

          await this.eventBus.publish(createHarnessEvent({
            type: 'output.validated',
            runId: stepContext.runId,
            requestId: stepContext.requestId,
            stepRunId: stepContext.stepRunId,
            attemptId: stepContext.attemptId,
            payload: {
              outputName: input.purpose === 'jobDescription' ? 'ParsedJobDescriptionResult' : 'ParsedDocumentResult',
              outputDigest: createDigest({
                rawText: result.rawText,
                markdown: result.markdown,
                structured: result.structured,
              }),
              passed: true,
            },
          }))

          return result
        },
      })
      steps.push(parseStep.step)

      await this.publishWorkflowStatus('workflow.succeeded', runContext.runId, runContext.requestId, {
        workflowName: 'ocr_document_parse',
        workflowVersion: runContext.workflowVersion,
        finishedAt: new Date().toISOString(),
      })

      return {
        ...parseStep.result,
        run_id: runContext.runId,
        step_statuses: steps,
      }
    } catch (error) {
      const actualError = error instanceof StepRunError ? error.cause : error
      await this.publishWorkflowStatus('workflow.failed', runContext.runId, runContext.requestId, {
        workflowName: 'ocr_document_parse',
        workflowVersion: runContext.workflowVersion,
        finishedAt: new Date().toISOString(),
        errorMessage: actualError instanceof Error ? actualError.message : '未知错误',
      })

      throw actualError
    }
  }

  private async publishWorkflowStatus(
    type: 'workflow.started' | 'workflow.succeeded' | 'workflow.failed' | 'workflow.partial',
    runId: string,
    requestId: string,
    payload: Record<string, unknown>
  ) {
    await this.eventBus.publish(createHarnessEvent({
      type,
      runId,
      requestId,
      payload,
    }))
  }
}
