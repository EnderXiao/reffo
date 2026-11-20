import type {ResultSessionProgressRecord} from '@/types'

/**
 * 只有真正跑完全部阶段的历史才算“已完成”。
 * 历史记录在 analysis 阶段就会落库，不能只看记录是否存在：
 * 否则中断的任务在下次 tick 时会被误判完成，永远停在「生成中」。
 */
export function isHistoryFullyDelivered(history: {
  progress?: ResultSessionProgressRecord | null
  processResult?: {optimized?: unknown; interview?: unknown; [key: string]: unknown} | null
  optimizedContent?: string | null
}): boolean {
  const progress = history.progress
  if (progress && progress.interview === 'done' && progress.optimized === 'done') return true
  if (history.processResult?.interview && history.processResult?.optimized) return true
  // 已有可展示正文（用户编辑或旧版本写入）：不能重跑覆盖。
  return Boolean(history.optimizedContent && history.optimizedContent.trim())
}
