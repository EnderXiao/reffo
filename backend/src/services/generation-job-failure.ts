import {recoveryAdviceForErrorCode} from '@/harness/recovery-advice'
import type {GenerationJobFailure, GenerationJobStage} from '@/types/generation-job'
import {V5WorkflowBlockedError} from '@/v5/errors'
import {GenerationJobVersionError} from './generation-job-version'
import {ResumeQuotaError} from './resume-quota'
import {sanitizeWritingRecoveryDiagnostics} from '@/v5/writing/recovery-diagnostics'

const stageNames: Record<GenerationJobStage, string> = {
  analysis: '源简历分析', matching: '岗位分析', optimized: '相契简历', interview: '面试建议', saving: '结果保存',
}
const diagnosticCode = /^[A-Z][A-Z0-9_]{0,99}$/
const runIdentifier = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/

/** Persist correlation and error categories only, never model text or source details. */
export function generationJobFailure(error: unknown, stage: GenerationJobStage, now = new Date().toISOString()) {
  const workflowError = error instanceof V5WorkflowBlockedError ? error : undefined
  const knownError = workflowError ?? (error instanceof ResumeQuotaError || error instanceof GenerationJobVersionError ? error : undefined)
  const code = knownError && diagnosticCode.test(knownError.code) ? knownError.code : 'GENERATION_FAILED'
  const advice = recoveryAdviceForErrorCode(code)
  const runId = workflowError?.runId && runIdentifier.test(workflowError.runId) ? workflowError.runId : undefined
  const issueCodes = [...new Set(workflowError?.issues.map(issue => issue.code).filter(value => diagnosticCode.test(value)) ?? [])]
  let retryable = advice.retryable
  let action = advice.action
  let message = `${stageNames[stage]}暂未完成，任务已停止。请保留当前材料，待服务修复后再生成。`

  if (error instanceof ResumeQuotaError) {
    message = error.message
    action = 'wait_for_quota_reset'
    retryable = false
  } else if (error instanceof GenerationJobVersionError) {
    message = error.message
    action = 'restart_with_current_release'
    retryable = true
  } else if (code === 'RESUME_STAGE_BUSY') {
    message = '相同内容正在处理中，已完成的步骤已保留，请稍后重试。'
    retryable = true
  } else if (code === 'V5_CONTEXT_BUDGET_EXCEEDED') {
    message = `${stageNames[stage]}处理超出本次服务容量，已停止生成。请保留原材料，待服务修复后再生成。`
  } else if (workflowError?.state === 'provider_failure') {
    retryable = workflowError.retryable
    action = retryable ? 'retry_preserved_checkpoint' : 'inspect_provider_configuration'
    message = retryable ? '模型服务暂时不可用，已完成的步骤已保留，请稍后重试。'
      : '模型服务请求未完成，已停止生成。需要检查服务配置后再生成。'
  } else if (workflowError?.state === 'blocked_fact_validation' || workflowError?.state === 'blocked_input_validation'
    || code === 'V5_SCHEMA_VALIDATION_FAILED') {
    message = `${stageNames[stage]}结果未通过完整性或准确性检查，已停止后续生成。请保留当前材料，待服务修复后再生成。`
    retryable = false
    action = 'inspect_stage_validation'
  } else if (workflowError?.state === 'blocked_quality_validation') {
    message = `${stageNames[stage]}结果未达到交付质量要求，已停止交付。请保留当前材料，待服务修复后再生成。`
    retryable = false
    action = 'inspect_delivery_quality'
  }

  const writingRecovery = sanitizeWritingRecoveryDiagnostics(workflowError?.writingRecovery)
  const failure: GenerationJobFailure = {code, stage, ...(runId ? {runId} : {}), issueCodes,
    ...(writingRecovery ? {writingRecovery} : {}), retryable, action, occurredAt: now}
  return {message, failure}
}
