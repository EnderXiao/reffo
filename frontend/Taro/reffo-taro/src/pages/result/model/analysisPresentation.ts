import type {
  MatchGapPriority,
  ProcessResult,
  WeaknessEvidenceType,
} from '@/types'

export interface GapViewItem {
  id: string
  priority?: MatchGapPriority
  evidenceType?: WeaknessEvidenceType
  title: string
  jdRequirement: string
  evidence: string
  impact: string
  suggestion: string
}

export interface OptimizationStrategyViewItem {
  id: string
  relatedGapIds: string[]
  strategyPoint: string
  rationale: string
  sourceQuote: string
  optimizedContent: string
  structured: boolean
}

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanItems(value: unknown, limit: number) {
  if (!Array.isArray(value)) return []

  return value
    .map(clean)
    .filter(Boolean)
    .slice(0, limit)
}

export function buildGapViewItems(result: ProcessResult): GapViewItem[] {
  const details = result.matching.weakness_details ?? []
  const structuredItems = details
    .filter(detail => clean(detail.weakness).length > 0)
    .slice(0, 4)
    .map((detail, index) => ({
      id: clean(detail.id) || `G${index + 1}`,
      priority: detail.priority,
      evidenceType: detail.evidence_type,
      title: clean(detail.weakness),
      jdRequirement: clean(detail.jd_requirement),
      evidence: clean(detail.evidence),
      impact: clean(detail.impact),
      suggestion: clean(detail.suggestion),
    }))

  if (structuredItems.length > 0) {
    return structuredItems
  }

  const fallbackItems = cleanItems(result.matching.weaknesses, 4)
  const legacyItems = fallbackItems.length > 0
    ? fallbackItems
    : cleanItems(result.analysis.weaknesses, 4)

  return legacyItems.map((title, index) => ({
    id: `G${index + 1}`,
    title,
    jdRequirement: '',
    evidence: '',
    impact: '',
    suggestion: '',
  }))
}

export function buildOptimizationStrategyViewItems(
  result: ProcessResult,
): OptimizationStrategyViewItem[] {
  const details = result.matching.optimization_strategy_details ?? []
  const structuredItems = details
    .filter(detail => clean(detail.strategy_point).length > 0)
    .slice(0, 4)
    .map((detail, index) => ({
      id: clean(detail.id) || `S${index + 1}`,
      relatedGapIds: cleanItems(detail.related_gap_ids, 4),
      strategyPoint: clean(detail.strategy_point),
      rationale: clean(detail.rationale),
      sourceQuote: clean(detail.optimization_example?.source_quote),
      optimizedContent: clean(detail.optimization_example?.optimized_content),
      structured: true,
    }))

  if (structuredItems.length > 0) {
    return structuredItems
  }

  return cleanItems(result.matching.optimization_suggestions, 5)
    .map((strategyPoint, index) => ({
      id: `S${index + 1}`,
      relatedGapIds: [],
      strategyPoint,
      rationale: '',
      sourceQuote: '',
      optimizedContent: '',
      structured: false,
    }))
}
