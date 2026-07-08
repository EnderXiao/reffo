import { InterviewAdvisorAgent } from '@/agents/interview-advisor'
import { JDParserAgent } from '@/agents/jd-parser'
import { MatchingAgent } from '@/agents/matching-agent'
import { ResumeAnalyzerAgent } from '@/agents/resume-analyzer'
import { ResumeGeneratorAgent } from '@/agents/resume-generator'
import { createHarnessEventBus, type HarnessEventBus } from '@/harness/event-bus'
import { evaluateMarkdownResume } from '@/harness/evaluators/markdown-resume-evaluator'
import { judgeResumeWithLlm } from '@/harness/evaluators/llm-judge-evaluator'
import { createHarnessEvent, type WorkflowStatus } from '@/harness/events'
import { resolvePromptVariant } from '@/harness/prompt-variant'
import { createDigest, createRunContext } from '@/harness/run-context'
import { runStep, StepRunError, type StepRunSnapshot } from '@/harness/run-step'
import { logHarnessEvent } from '@/harness/subscribers/log-subscriber'
import { PersistenceSubscriber } from '@/harness/subscribers/persistence-subscriber'
import { TraceSubscriber } from '@/harness/subscribers/trace-subscriber'
import type { MvpProcessResponse } from '@/types'

export interface ResumeOptimizationWorkflowInput {
  resume_markdown: string
  jd_text: string
  workflowTimeoutMs?: number
  prompt_variant?: string
  enable_llm_judge?: boolean
}

export class ResumeOptimizationWorkflow {
  private readonly eventBus: HarnessEventBus
  private readonly analyzer = new ResumeAnalyzerAgent()
  private readonly jdParser = new JDParserAgent()
  private readonly matcher = new MatchingAgent()
  private readonly generator = new ResumeGeneratorAgent()
  private readonly advisor = new InterviewAdvisorAgent()
  private readonly traceSubscriber = new TraceSubscriber()
  private readonly persistenceSubscriber = new PersistenceSubscriber()

  constructor(eventBus: HarnessEventBus = createHarnessEventBus()) {
    this.eventBus = eventBus
    this.eventBus.subscribe('*', this.traceSubscriber.handle)
    this.eventBus.subscribe('*', this.persistenceSubscriber.handle)
    this.eventBus.subscribe('*', logHarnessEvent)
  }

  async run(input: ResumeOptimizationWorkflowInput): Promise<MvpProcessResponse> {
    const promptVariant = resolvePromptVariant(input.prompt_variant)
    const runContext = createRunContext(`v1:${promptVariant}`)
    const steps: StepRunSnapshot[] = []
    const recoverableErrors: MvpProcessResponse['recoverable_errors'] = []
    const workflowDeadline = Date.now() + (input.workflowTimeoutMs ?? 480000)
    const getRemainingWorkflowTimeout = () => Math.max(1, workflowDeadline - Date.now())

    await this.publishWorkflowStatus('workflow.started', runContext.runId, runContext.requestId, {
      workflowName: runContext.workflowName,
      workflowVersion: runContext.workflowVersion,
      promptVariant,
      inputDigest: createDigest({
        resume_markdown: input.resume_markdown,
        jd_text: input.jd_text,
      }),
    })

    try {
      const analysisStep = await runStep({
        runContext,
        eventBus: this.eventBus,
        stepName: 'analyze_resume',
        timeoutMs: Math.min(120000, getRemainingWorkflowTimeout()),
        execute: (stepContext) =>
          this.analyzer.analyze(input.resume_markdown, {
            eventBus: this.eventBus,
            stepContext,
            promptVariant,
          }),
      })
      steps.push(analysisStep.step)

      const jdStep = await runStep({
        runContext,
        eventBus: this.eventBus,
        stepName: 'parse_jd',
        timeoutMs: Math.min(90000, getRemainingWorkflowTimeout()),
        execute: (stepContext) =>
          this.jdParser.parse(input.jd_text, {
            eventBus: this.eventBus,
            stepContext,
            promptVariant,
          }),
      })
      steps.push(jdStep.step)

      const matchingStep = await runStep({
        runContext,
        eventBus: this.eventBus,
        stepName: 'match_resume_to_jd',
        timeoutMs: Math.min(120000, getRemainingWorkflowTimeout()),
        execute: (stepContext) =>
          this.matcher.match(analysisStep.result.structured_resume, jdStep.result, {
            eventBus: this.eventBus,
            stepContext,
            promptVariant,
          }),
      })
      steps.push(matchingStep.step)

      const generationStep = await runStep({
        runContext,
        eventBus: this.eventBus,
        stepName: 'generate_resume',
        timeoutMs: Math.min(120000, getRemainingWorkflowTimeout()),
        execute: (stepContext) =>
          this.generator.generate(
            analysisStep.result.structured_resume,
            jdStep.result,
            matchingStep.result,
            {
              eventBus: this.eventBus,
              stepContext,
              promptVariant,
            }
          ),
      })
      steps.push(generationStep.step)

      let workflowStatus: WorkflowStatus = 'succeeded'
      const validationResult = await this.runRecoverableStep(
        steps,
        recoverableErrors,
        () =>
          runStep({
            runContext,
            eventBus: this.eventBus,
            stepName: 'validate_resume',
            timeoutMs: Math.min(30000, getRemainingWorkflowTimeout()),
            execute: async (stepContext) => {
              const evaluation = evaluateMarkdownResume(generationStep.result, analysisStep.result.structured_resume)

              await this.eventBus.publish(
                createHarnessEvent({
                  type: 'evaluation.completed',
                  runId: stepContext.runId,
                  requestId: stepContext.requestId,
                  stepRunId: stepContext.stepRunId,
                  attemptId: stepContext.attemptId,
                  payload: { ...evaluation },
                })
              )

              if (!evaluation.passed) {
                const errorMessages = evaluation.issues
                  .filter((issue) => issue.severity === 'error')
                  .map((issue) => issue.message)
                  .join('；')
                throw new Error(`优化简历规则校验失败: ${errorMessages}`)
              }

              return evaluation
            },
          })
      )

      if (!validationResult) {
        workflowStatus = 'partial'
        await this.publishWorkflowStatus('workflow.partial', runContext.runId, runContext.requestId, {
          workflowName: runContext.workflowName,
          workflowVersion: runContext.workflowVersion,
          finishedAt: new Date().toISOString(),
          recoverableErrors,
        })

        return {
          run_id: runContext.runId,
          workflow_status: workflowStatus,
          step_statuses: steps,
          recoverable_errors: recoverableErrors,
          step1_analysis: analysisStep.result,
          step2_matching: matchingStep.result,
          step3_optimized_resume: generationStep.result,
        }
      }

      if (input.enable_llm_judge) {
        this.scheduleLlmJudge({
          runContext,
          promptVariant,
          resumeAnalysis: analysisStep.result,
          matchAnalysis: matchingStep.result,
          optimizedResume: generationStep.result,
          getRemainingWorkflowTimeout,
        })
      }

      const adviceStep = await this.runRecoverableStep(
        steps,
        recoverableErrors,
        () =>
          runStep({
            runContext,
            eventBus: this.eventBus,
            stepName: 'generate_interview_advice',
            timeoutMs: Math.min(120000, getRemainingWorkflowTimeout()),
            execute: (stepContext) =>
              this.advisor.advise(analysisStep.result, matchingStep.result, generationStep.result, {
                eventBus: this.eventBus,
                stepContext,
                promptVariant,
              }),
          })
      )

      if (!adviceStep) {
        workflowStatus = 'partial'
      }

      await this.publishWorkflowStatus(
        workflowStatus === 'partial' ? 'workflow.partial' : 'workflow.succeeded',
        runContext.runId,
        runContext.requestId,
        {
          workflowName: runContext.workflowName,
          workflowVersion: runContext.workflowVersion,
          finishedAt: new Date().toISOString(),
          recoverableErrors,
        }
      )

      return {
        run_id: runContext.runId,
        workflow_status: workflowStatus,
        step_statuses: steps,
        recoverable_errors: recoverableErrors.length > 0 ? recoverableErrors : undefined,
        step1_analysis: analysisStep.result,
        step2_matching: matchingStep.result,
        step3_optimized_resume: generationStep.result,
        step4_interview_suggestions: adviceStep?.result,
      }
    } catch (error) {
      await this.publishWorkflowStatus('workflow.failed', runContext.runId, runContext.requestId, {
        workflowName: runContext.workflowName,
        workflowVersion: runContext.workflowVersion,
        finishedAt: new Date().toISOString(),
        errorMessage: error instanceof Error ? error.message : '未知错误',
      })

      throw error instanceof StepRunError ? error.cause : error
    }
  }

  private async runRecoverableStep<TResult>(
    steps: StepRunSnapshot[],
    recoverableErrors: NonNullable<MvpProcessResponse['recoverable_errors']>,
    execute: () => Promise<{ result: TResult; step: StepRunSnapshot }>
  ) {
    try {
      const result = await execute()
      steps.push(result.step)
      return result
    } catch (error) {
      if (error instanceof StepRunError) {
        steps.push(error.step)
        recoverableErrors.push({
          stepName: error.step.stepName,
          errorCode: error.step.errorCode ?? 'RECOVERABLE_STEP_FAILED',
          message: error.step.errorMessage ?? error.message,
        })
        return null
      }

      throw error
    }
  }

  private scheduleLlmJudge(input: {
    runContext: ReturnType<typeof createRunContext>
    promptVariant: string
    resumeAnalysis: MvpProcessResponse['step1_analysis']
    matchAnalysis: MvpProcessResponse['step2_matching']
    optimizedResume: string
    getRemainingWorkflowTimeout: () => number
  }) {
    void runStep({
      runContext: input.runContext,
      eventBus: this.eventBus,
      stepName: 'llm_judge_resume',
      timeoutMs: Math.min(120000, input.getRemainingWorkflowTimeout()),
      execute: async (stepContext) => {
        const evaluation = await judgeResumeWithLlm({
          resumeAnalysis: input.resumeAnalysis,
          matchAnalysis: input.matchAnalysis,
          optimizedResume: input.optimizedResume,
          promptVariant: input.promptVariant,
          eventBus: this.eventBus,
          stepContext,
        })

        await this.eventBus.publish(
          createHarnessEvent({
            type: 'evaluation.completed',
            runId: stepContext.runId,
            requestId: stepContext.requestId,
            stepRunId: stepContext.stepRunId,
            attemptId: stepContext.attemptId,
            payload: { ...evaluation },
          })
        )

        return evaluation
      },
    }).catch((error) => {
      console.error('LLM judge failed:', error)
    })
  }

  private async publishWorkflowStatus(
    type: 'workflow.started' | 'workflow.succeeded' | 'workflow.failed' | 'workflow.partial',
    runId: string,
    requestId: string,
    payload: Record<string, unknown>
  ) {
    await this.eventBus.publish(
      createHarnessEvent({
        type,
        runId,
        requestId,
        payload,
      })
    )
  }
}
