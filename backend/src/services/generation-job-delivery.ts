import type {ResumeHistoryRecord} from '@/types'

/**
 * 历史记录在 analysis 阶段就会落库。已有可展示正文时，简历已交付，
 * 面试建议可以独立生成。旧版历史也可通过完整进度或结果识别。
 */
export function isHistoryFullyDelivered(history: Pick<ResumeHistoryRecord, 'progress' | 'process_result' | 'optimized_content'>): boolean {
  const progress = history.progress
  if (progress && progress.interview === 'done' && progress.optimized === 'done') return true
  const result = history.process_result as {optimized?: unknown; interview?: unknown} | undefined
  if (result?.interview && result?.optimized) return true
  // 已有可展示正文（用户编辑或旧版本写入）：不能重跑覆盖。
  return history.optimized_content.trim().length > 0
}
