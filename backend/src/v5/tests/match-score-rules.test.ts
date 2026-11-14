import {describe, expect, test} from 'bun:test'
import {calculateV5MatchScore} from '@/v5/match-score'
import {projectLegacyMatch} from '@/v5/targeting/fit'
import {toMatchAnalysis} from '@/v5/main/compatibility'
import type {RequirementJudgmentBundle} from '@/v5/targeting/judgments'
import {createTargetingFixture} from './targeting-fixtures'

type Status = RequirementJudgmentBundle['items'][number]['status']
function fixture(statuses: Status[], importance: Array<'must_have' | 'core_outcome' | 'differentiator' | 'nice_to_have'> = []) {
  const f = createTargetingFixture()
  const match = projectLegacyMatch(f.fit, f.targets, f.resume, f.job)
  const requirement = f.job.requirementAtoms[0]!, judgment = match.judgmentBundle!.items[0]!
  f.job.requirementAtoms = statuses.map((_, index) => ({...structuredClone(requirement), requirementId: `r${index}`,
    importance: importance[index] ?? 'core_outcome', logicGroupId: null, logicOperator: null,
    semantics: {...requirement.semantics!, scoringGroupId: `g${index}`}}))
  match.judgmentBundle!.items = statuses.map((status, index) => ({...structuredClone(judgment), requirementId: `r${index}`, status, conflict: null}))
  return {resume: f.resume, job: f.job, match}
}

describe('current material requirement coverage score v3', () => {
  test('emits a score with partial unknown coverage while retaining uncertainty', () => {
    const f = fixture(['direct', 'transferable_or_partial', 'unproven'])
    const result = calculateV5MatchScore(f)
    expect(result.score).toBe(53)
    expect(result.confidence).toBe('low')
    expect(result.metadata).toMatchObject({calibrationStatus: 'rules_based', scoreBasis: 'current_material_requirement_coverage', evaluatedGroupCount: 2, unprovenGroupCount: 1})
    expect(f.match.judgmentBundle!.items[2]!.status).toBe('unproven')
    const publicMatch = toMatchAnalysis({resumeEvidenceBundle: f.resume, jobRequirementBundle: f.job, matchAnalysis: f.match, matchScore: result})
    expect(publicMatch).toMatchObject({match_score: 53, score_formula_version: 'match-score-v3', score_calibration_status: 'rules_based', score_confidence: 'low'})
  })
  test('does not turn all unknown or missing source material into a numeric score', () => {
    for (const statuses of [[], ['unproven'], ['unproven', 'unproven']] as Status[][]) expect(calculateV5MatchScore(fixture(statuses)).score).toBeNull()
    const f = fixture(['direct']); f.resume.evidenceAtoms = []
    expect(calculateV5MatchScore(f).score).toBeNull()
  })
  test('zero is valid for explicit mismatches; source richness cannot inflate it', () => {
    const f = fixture(['not_met', 'not_met'])
    expect(calculateV5MatchScore(f).score).toBe(0)
    f.resume.evidenceAtoms.push(...structuredClone(f.resume.evidenceAtoms))
    expect(calculateV5MatchScore(f).score).toBe(0)
  })
  test('normalizes applicable dimensions and keeps frozen category priorities', () => {
    expect(calculateV5MatchScore(fixture(['direct'])).score).toBe(100)
    expect(calculateV5MatchScore(fixture(['direct'], ['must_have'])).score).toBe(100)
    expect(calculateV5MatchScore(fixture(['direct'], ['nice_to_have'])).score).toBe(100)
    expect(calculateV5MatchScore(fixture(['direct', 'not_met'], ['must_have', 'core_outcome'])).score).toBe(54)
    expect(calculateV5MatchScore(fixture(['direct', 'not_met'], ['core_outcome', 'nice_to_have'])).score).toBe(83)
  })
  test('duplicate projections do not multiply points or mask a stricter gate', () => {
    const f = fixture(['direct', 'not_met']), original = calculateV5MatchScore(f)
    f.job.requirementAtoms.push({...structuredClone(f.job.requirementAtoms[0]!), requirementId: 'duplicate'})
    f.match.judgmentBundle!.items.push({...structuredClone(f.match.judgmentBundle!.items[0]!), requirementId: 'duplicate'})
    expect(calculateV5MatchScore(f).score).toBe(original.score)
    expect(calculateV5MatchScore(f).metadata!.deduplicatedRequirementCount).toBe(1)
    f.match.judgmentBundle!.items[2]!.status = 'not_met'
    expect(calculateV5MatchScore(f).score).toBe(0)
  })
  test('explicit OR uses its best alternative and preserves unresolved alternatives', () => {
    const f = fixture(['direct', 'unproven'], ['must_have', 'nice_to_have'])
    f.job.requirementAtoms.forEach(item => {item.logicGroupId = 'choice'; item.logicOperator = 'or'})
    expect(calculateV5MatchScore(f).score).toBe(100)
    expect(calculateV5MatchScore(f).metadata!.unprovenGroupCount).toBe(0)
    f.match.judgmentBundle!.items[0]!.status = 'not_met'
    expect(calculateV5MatchScore(f).score).toBe(0)
    expect(calculateV5MatchScore(f).metadata!.unprovenGroupCount).toBe(1)
    f.match.judgmentBundle!.items[1]!.status = 'direct'
    expect(calculateV5MatchScore(f).score).toBe(100)
  })
  test('conflicts and omitted judgments remain unknown, not explicit mismatches', () => {
    const f = fixture(['direct', 'direct'])
    f.match.judgmentBundle!.items[1]!.conflict = '来源冲突'
    expect(calculateV5MatchScore(f)).toMatchObject({score: 50, confidence: 'low', metadata: {conflictingGroupCount: 1, unprovenGroupCount: 1}})
    f.match.judgmentBundle!.items = []
    expect(calculateV5MatchScore(f).score).toBeNull()
  })
})
