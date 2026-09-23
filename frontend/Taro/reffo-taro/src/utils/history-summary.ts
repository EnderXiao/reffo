import type {ResumeHistory, ResumeHistorySummary} from '@/types'

export function toResumeHistorySummaryFromHistory(
  history: ResumeHistory,
): ResumeHistorySummary {
  const location = history.resultContext?.location?.trim()
    || history.jdContent?.match(
      /(?:工作地点|工作地|办公地点|办公地|地点|城市|Base地|base地|Base|base)[：:]\s*(.+?)(?:\n|\r|$)/i,
    )?.[1]?.trim()
    || '--'
  const suggestions = (
    history.optimizationSuggestions
      || history.processResult?.matching.optimization_suggestions
      || history.changesSummary
      || history.processResult?.optimized.changes_summary
      || history.processResult?.analysis.suggestions
      || []
  ).map(value => value.trim()).filter(Boolean).slice(0, 2)

  return {
    id: history.id,
    position: history.position,
    company: history.company,
    name: history.name,
    createdAt: history.createdAt,
    updatedAt: history.updatedAt || history.createdAt,
    qualityScore: history.qualityScore,
    matchScore: history.matchScore,
    tags: history.tags,
    location,
    strategyBody: suggestions.join('\n\n') || '暂无后端优化策略，请进入详情页查看完整分析。',
    ...(history.cardColor ? {cardColor: history.cardColor} : {}),
    ...(history.cardPattern ? {cardPattern: history.cardPattern} : {}),
  }
}
