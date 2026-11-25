/**
 * 恢复决策与恢复摘要类型。
 *
 * 注意：本文件只保留对外响应契约（MvpProcessResponse.recovery_summary）需要的类型。
 * 原有的通用「分类 → 决策」运行时状态机已随 runtime-state.ts 删除——
 * 生产主流程的恢复决策由 fallback-provider 与 v5 runRepairableStage 各自实现，
 * 这里不再维护一套与生产脱节的并行决策体系。
 */

export type HarnessDecision =
  | { action: 'accept' }
  | { action: 'retry_same_step'; reason: string }
  | { action: 'repair_json'; reason: string }
  | { action: 'revise_output'; reason: string; revisionStep: 'revise_resume' }
  | { action: 'fallback_model'; reason: string }
  | { action: 'return_partial'; reason: string }
  | { action: 'fail'; reason: string }

export interface RecoverySummary {
  triggerStep: string
  action: HarnessDecision['action']
  issueCodes?: string[]
  result: 'succeeded' | 'failed' | 'skipped'
  attempts: number
  reason?: string
}
