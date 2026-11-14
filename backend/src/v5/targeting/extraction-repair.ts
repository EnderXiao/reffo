import type {ValidationIssue} from '@/v5/types'
import type {TargetedJobExtraction} from './contracts'

const signalPath = /^(explicitCompanySignals|explicitLocationSignals)\[(\d+)\]\.requirementLocalIds$/u

/** A complete P02R transport must not replace verified qualifications merely
 * to fix an unrelated association. No source/ID meaning is guessed locally.
 */
export function prepareTargetedSignalRepair(current: TargetedJobExtraction, issues: ValidationIssue[]) {
  const errors = issues.filter(issue => issue.severity === 'error')
  if (!errors.length || errors.some(issue => issue.code !== 'INVALID_SIGNAL_REFERENCE')) return null
  const targets = errors.map(issue => {
    const match = issue.outputPath?.match(signalPath)
    if (!match) return null
    const field = match[1] as 'explicitCompanySignals' | 'explicitLocationSignals'
    const index = Number(match[2])
    return current[field][index] ? {field, index} : null
  })
  if (targets.some(target => !target)) return null
  const validIds = new Set(current.requirementCandidates.map(item => item.requirementLocalId))
  return {currentOutput: current, merge(repaired: TargetedJobExtraction): TargetedJobExtraction {
    const merged = structuredClone(current)
    for (const target of targets) {
      const {field, index} = target!
      const original = current[field][index]!, proposed = repaired[field][index]
      if (!proposed || proposed.statement !== original.statement
        || proposed.requirementLocalIds.some(id => !validIds.has(id))
        || new Set(proposed.requirementLocalIds).size !== proposed.requirementLocalIds.length
        || original.requirementLocalIds.some(id => validIds.has(id) && !proposed.requirementLocalIds.includes(id))) {
        throw new Error('P02_SIGNAL_REPAIR_SCOPE_MISMATCH')
      }
      merged[field][index] = {...original, requirementLocalIds: [...proposed.requirementLocalIds]}
    }
    return merged
  }}
}
