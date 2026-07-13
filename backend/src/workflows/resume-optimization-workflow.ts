import { InterviewAdvisorAgent } from '@/agents/interview-advisor'
import { JDParserAgent } from '@/agents/jd-parser'
import { MatchingAgent } from '@/agents/matching-agent'
import { ResumeAnalyzerAgent } from '@/agents/resume-analyzer'
import { ResumeGeneratorAgent } from '@/agents/resume-generator'
import { ResumeRevisionAgent } from '@/agents/resume-revision'
import { createHarnessEventBus, type HarnessEventBus } from '@/harness/event-bus'
import { evaluateMarkdownResume } from '@/harness/evaluators/markdown-resume-evaluator'
import { judgeResumeWithLlm } from '@/harness/evaluators/llm-judge-evaluator'
import { createHarnessEvent, type WorkflowStatus } from '@/harness/events'
import { resolvePromptVariant } from '@/harness/prompt-variant'
import { createDigest, createRunContext } from '@/harness/run-context'
import { runStep, StepRunError, type StepRunSnapshot } from '@/harness/run-step'
import {
  buildQualityGateAttempt,
  classifyAttemptResult,
  createRunRuntimeState,
  decideNextAction,
} from '@/harness/runtime-state'
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

export interface ResumeOptimizationWorkflowAgents {
  analyzer?: Pick<ResumeAnalyzerAgent, 'analyze'>
  jdParser?: Pick<JDParserAgent, 'parse'>
  matcher?: Pick<MatchingAgent, 'match'>
  generator?: Pick<ResumeGeneratorAgent, 'generate'>
  reviser?: Pick<ResumeRevisionAgent, 'revise'>
  advisor?: Pick<InterviewAdvisorAgent, 'advise'>
}

export interface ResumeOptimizationWorkflowOptions {
  enableDefaultSubscribers?: boolean
}

export class ResumeOptimizationWorkflow {
  private readonly eventBus: HarnessEventBus
  private readonly analyzer: Pick<ResumeAnalyzerAgent, 'analyze'>
  private readonly jdParser: Pick<JDParserAgent, 'parse'>
  private readonly matcher: Pick<MatchingAgent, 'match'>
  private readonly generator: Pick<ResumeGeneratorAgent, 'generate'>
  private readonly reviser: Pick<ResumeRevisionAgent, 'revise'>
  private readonly advisor: Pick<InterviewAdvisorAgent, 'advise'>
  private readonly traceSubscriber = new TraceSubscriber()
  private readonly persistenceSubscriber = new PersistenceSubscriber()

  constructor(
    eventBus: HarnessEventBus = createHarnessEventBus(),
    agents: ResumeOptimizationWorkflowAgents = {},
    options: ResumeOptimizationWorkflowOptions = {}
  ) {
    this.eventBus = eventBus
    this.analyzer = agents.analyzer ?? new ResumeAnalyzerAgent()
    this.jdParser = agents.jdParser ?? new JDParserAgent()
    this.matcher = agents.matcher ?? new MatchingAgent()
    this.generator = agents.generator ?? new ResumeGeneratorAgent()
    this.reviser = agents.reviser ?? new ResumeRevisionAgent()
    this.advisor = agents.advisor ?? new InterviewAdvisorAgent()

    if (options.enableDefaultSubscribers !== false) {
      this.eventBus.subscribe('*', this.traceSubscriber.handle)
      this.eventBus.subscribe('*', this.persistenceSubscriber.handle)
      this.eventBus.subscribe('*', logHarnessEvent)
    }
  }

  async run(input: ResumeOptimizationWorkflowInput): Promise<MvpProcessResponse> {
    const promptVariant = resolvePromptVariant(input.prompt_variant)
    const runContext = createRunContext(`v2:${promptVariant}`)
    const runtimeState = createRunRuntimeState(runContext)
    const steps = runtimeState.steps
    const recoverableErrors: NonNullable<MvpProcessResponse['recoverable_errors']> = []
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

      runtimeState.latestOutputs.resumeAnalysis = analysisStep.result
      runtimeState.latestOutputs.jd = jdStep.result
      runtimeState.latestOutputs.matchAnalysis = matchingStep.result
      runtimeState.latestOutputs.optimizedResume = generationStep.result

      let workflowStatus: WorkflowStatus = 'succeeded'
      let optimizedResume = generationStep.result
      let validationPassed = false
      let revisionAttempts = 0
      const maxRevisionAttempts = 2
      const recoveryIssueCodes = new Set<string>()
      let latestQualityGateMessage = '优化简历质量门禁未通过'

      while (revisionAttempts <= maxRevisionAttempts) {
        const validationStep = await runStep({
          runContext,
          eventBus: this.eventBus,
          stepName: 'validate_resume',
          timeoutMs: Math.min(30000, getRemainingWorkflowTimeout()),
          execute: async (stepContext) => {
            const evaluation = evaluateMarkdownResume(optimizedResume, analysisStep.result.structured_resume)

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
        })
        steps.push(validationStep.step)
        runtimeState.evaluations.push(validationStep.result)

        const qualityGateAttempt = buildQualityGateAttempt({
          stepName: validationStep.step.stepName,
          attemptNumber: revisionAttempts + 1,
          evaluation: validationStep.result,
        })
        runtimeState.attempts.push(qualityGateAttempt)

        const classification = classifyAttemptResult(qualityGateAttempt)
        const decision = decideNextAction(classification)

        if (decision.action === 'accept') {
          validationPassed = true
          if (revisionAttempts > 0) {
            runtimeState.recoverySummary.push({
              triggerStep: 'validate_resume',
              action: 'revise_output',
              issueCodes: [...recoveryIssueCodes],
              result: 'succeeded',
              attempts: revisionAttempts,
              reason: `第 ${revisionAttempts} 次修订后通过质量门禁`,
            })
            await this.publishRecoveryStatus('recovery.succeeded', runContext.runId, runContext.requestId, {
              triggerStep: 'validate_resume',
              action: 'revise_output',
              attempts: revisionAttempts,
              issueCodes: [...recoveryIssueCodes],
            })
          }
          break
        }

        validationStep.result.issues.forEach((issue) => recoveryIssueCodes.add(issue.code))
        latestQualityGateMessage = qualityGateAttempt.error?.message || decision.reason || latestQualityGateMessage

        if (decision.action !== 'revise_output' || revisionAttempts >= maxRevisionAttempts) {
          workflowStatus = 'partial'
          recoverableErrors.push({
            stepName: 'validate_resume',
            errorCode: qualityGateAttempt.error?.code ?? 'QUALITY_GATE_FAILED',
            message: latestQualityGateMessage,
          })
          runtimeState.recoverySummary.push({
            triggerStep: 'validate_resume',
            action: decision.action,
            issueCodes: [...recoveryIssueCodes],
            result: 'failed',
            attempts: revisionAttempts,
            reason: decision.reason ?? latestQualityGateMessage,
          })
          await this.publishRecoveryStatus('recovery.failed', runContext.runId, runContext.requestId, {
            triggerStep: 'validate_resume',
            action: decision.action,
            attempts: revisionAttempts,
            issueCodes: [...recoveryIssueCodes],
            reason: decision.reason ?? latestQualityGateMessage,
          })
          break
        }

        revisionAttempts += 1
        await this.publishRecoveryStatus('recovery.planned', runContext.runId, runContext.requestId, {
          triggerStep: 'validate_resume',
          action: decision.action,
          revisionStep: decision.revisionStep,
          attempts: revisionAttempts,
          issueCodes: [...recoveryIssueCodes],
          reason: decision.reason,
        })
        await this.publishRecoveryStatus('recovery.started', runContext.runId, runContext.requestId, {
          triggerStep: 'validate_resume',
          action: decision.action,
          revisionStep: decision.revisionStep,
          attempts: revisionAttempts,
        })

        const revisionStep = await this.runRecoverableStep(
          steps,
          recoverableErrors,
          () =>
            runStep({
              runContext,
              eventBus: this.eventBus,
              stepName: decision.revisionStep,
              timeoutMs: Math.min(120000, getRemainingWorkflowTimeout()),
              execute: (stepContext) =>
                this.reviser.revise(
                  analysisStep.result.structured_resume,
                  jdStep.result,
                  matchingStep.result,
                  optimizedResume,
                  validationStep.result,
                  {
                    eventBus: this.eventBus,
                    stepContext,
                    promptVariant,
                  }
                ),
            })
        )

        if (!revisionStep) {
          const latestRecoverableError = recoverableErrors.at(-1)
          runtimeState.attempts.push({
            stepName: decision.revisionStep,
            attemptNumber: revisionAttempts,
            status: 'failed',
            error: {
              code: latestRecoverableError?.errorCode ?? 'REVISION_STEP_FAILED',
              category: 'unknown',
              message: latestRecoverableError?.message ?? '简历修订 step 执行失败',
              retryable: false,
              repairable: false,
            },
          })
          workflowStatus = 'partial'
          runtimeState.recoverySummary.push({
            triggerStep: 'validate_resume',
            action: 'revise_output',
            issueCodes: [...recoveryIssueCodes],
            result: 'failed',
            attempts: revisionAttempts,
            reason: latestRecoverableError?.message ?? '简历修订 step 执行失败',
          })
          await this.publishRecoveryStatus('recovery.failed', runContext.runId, runContext.requestId, {
            triggerStep: 'validate_resume',
            action: 'revise_output',
            attempts: revisionAttempts,
            issueCodes: [...recoveryIssueCodes],
            reason: latestRecoverableError?.message ?? '简历修订 step 执行失败',
          })
          break
        }

        runtimeState.attempts.push({
          stepName: decision.revisionStep,
          attemptNumber: revisionAttempts,
          status: 'succeeded',
          output: revisionStep.result,
        })
        optimizedResume = revisionStep.result
        runtimeState.latestOutputs.optimizedResume = optimizedResume
      }

      if (!validationPassed) {
        workflowStatus = 'partial'
        await this.publishWorkflowStatus('workflow.partial', runContext.runId, runContext.requestId, {
          workflowName: runContext.workflowName,
          workflowVersion: runContext.workflowVersion,
          finishedAt: new Date().toISOString(),
          recoverableErrors,
          recoverySummary: runtimeState.recoverySummary,
        })

        return {
          run_id: runContext.runId,
          workflow_status: workflowStatus,
          step_statuses: steps,
          recoverable_errors: recoverableErrors,
          recovery_summary: runtimeState.recoverySummary,
          step1_analysis: analysisStep.result,
          step2_matching: matchingStep.result,
          step3_optimized_resume: optimizedResume,
        }
      }

      if (input.enable_llm_judge) {
        this.scheduleLlmJudge({
          runContext,
          promptVariant,
          resumeAnalysis: analysisStep.result,
          matchAnalysis: matchingStep.result,
          optimizedResume,
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
              this.advisor.advise(analysisStep.result, matchingStep.result, optimizedResume, {
                eventBus: this.eventBus,
                stepContext,
                promptVariant,
              }),
          })
      )

      if (!adviceStep) {
        workflowStatus = 'partial'
      } else {
        runtimeState.latestOutputs.interviewSuggestions = adviceStep.result
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
          recoverySummary: runtimeState.recoverySummary,
        }
      )

      return {
        run_id: runContext.runId,
        workflow_status: workflowStatus,
        step_statuses: steps,
        recoverable_errors: recoverableErrors.length > 0 ? recoverableErrors : undefined,
        recovery_summary: runtimeState.recoverySummary.length > 0 ? runtimeState.recoverySummary : undefined,
        step1_analysis: analysisStep.result,
        step2_matching: matchingStep.result,
        step3_optimized_resume: optimizedResume,
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

  private async publishRecoveryStatus(
    type: 'recovery.planned' | 'recovery.started' | 'recovery.succeeded' | 'recovery.failed',
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
