import type {RequirementAnalysis, RequirementAnalysisItem} from '@/types/requirement-analysis'

const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()) : []

/** Reuse for HTTP and old stored results. Invalid optional data never blocks the resume. */
export function normalizeRequirementAnalysis(value: unknown): RequirementAnalysis | undefined {
  const input = object(value)
  if (input?.version !== 'job-requirement-analysis-v1') return undefined
  const seen = new Set<string>()
  const item = (value: unknown): RequirementAnalysisItem | null => {
    const entry = object(value)
    if (!entry || typeof entry.id !== 'string' || !entry.id || seen.has(entry.id)
      || typeof entry.text !== 'string' || !entry.text.trim()
      || !['explicit', 'inferred', 'unknown'].includes(String(entry.basis))
      || !['necessary', 'preferred', 'unspecified'].includes(String(entry.strength))) return null
    seen.add(entry.id)
    const basis = entry.basis as RequirementAnalysisItem['basis']
    const sourceQuotes = strings(entry.sourceQuotes)
    if (basis !== 'unknown' && !sourceQuotes.length) return null
    return {
      id: entry.id, text: entry.text, basis,
      strength: basis === 'explicit' ? entry.strength as RequirementAnalysisItem['strength'] : 'unspecified',
      sourceQuotes, rationale: typeof entry.rationale === 'string' ? entry.rationale : '',
      ...(['knowledge', 'skill', 'experience', 'ability', 'behavior', 'motivation_fit'].includes(String(entry.dimension))
        ? {dimension: entry.dimension as RequirementAnalysisItem['dimension']} : {}),
      ...(typeof entry.evidenceExpectation === 'string' ? {evidenceExpectation: entry.evidenceExpectation} : {}),
    }
  }
  const items = (value: unknown): RequirementAnalysisItem[] => Array.isArray(value) ? value.slice(0, 20).flatMap(value => {
    const result = item(value)
    return result ? [result] : []
  }) : []
  return {
    version: 'job-requirement-analysis-v1', portrait: item(input.portrait),
    tasks: items(input.tasks), outcomes: items(input.outcomes), successConditions: items(input.successConditions),
    attributes: items(input.attributes), externalRequirements: items(input.externalRequirements),
    unknowns: strings(input.unknowns).slice(0, 20), conflicts: items(input.conflicts),
  }
}
