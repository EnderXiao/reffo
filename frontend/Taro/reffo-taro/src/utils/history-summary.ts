import type {ResumeHistory, ResumeHistorySummary} from '@/types'
import {buildResumeValueSummary} from '../../../../../shared/resume-strategy'

export function toResumeHistorySummaryFromHistory(
  history: ResumeHistory,
): ResumeHistorySummary {
  const location = history.resultContext?.location?.trim()
    || history.jdContent?.match(
      /(?:工作地点|工作地|办公地点|办公地|地点|城市|Base地|base地|Base|base)[：:]\s*(.+?)(?:\n|\r|$)/i,
    )?.[1]?.trim()
    || '--'
  const advice = [history.optimizationSuggestions,
    history.processResult?.matching.optimization_suggestions,
    history.processResult?.analysis.suggestions]
    .flatMap(values => Array.isArray(values) ? values : [])
  const summary = buildResumeValueSummary({
    markdown: history.optimizedContent,
    review: history.processResult?.optimized.strategy_review,
    advice,
  })

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
    strategyBody: summary.body,
    strategyTitle: summary.title,
    ...(history.cardColor ? {cardColor: history.cardColor} : {}),
    ...(history.cardPattern ? {cardPattern: history.cardPattern} : {}),
  }
}
