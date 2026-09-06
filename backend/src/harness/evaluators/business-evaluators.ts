import type { EvaluationIssue, EvaluationResult } from '@/harness/evaluators/markdown-resume-evaluator'
import type { InterviewSuggestions, JDStructure, MatchAnalysis, ResumeAnalysis, ResumeStructure } from '@/types'

function hasText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
}

function hasItems(value: unknown) {
  return Array.isArray(value) && value.length > 0
}

function calculateScore(issues: EvaluationIssue[]) {
  const errorCount = issues.filter((issue) => issue.severity === 'error').length
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length

  return Math.max(0, 100 - errorCount * 30 - warningCount * 10)
}

function buildResult(input: {
  evaluatorName: string
  evaluatorVersion?: string
  issues: EvaluationIssue[]
}): EvaluationResult {
  const errorCount = input.issues.filter((issue) => issue.severity === 'error').length

  return {
    evaluatorName: input.evaluatorName,
    evaluatorVersion: input.evaluatorVersion ?? 'v1',
    passed: errorCount === 0,
    score: calculateScore(input.issues),
    issues: input.issues,
  }
}

function getRequiredSkills(jd?: JDStructure) {
  return jd?.hard_requirements?.required_skills?.filter((skill) => skill.trim()) ?? []
}

function normalizeSkillTerm(value: string) {
  return value.trim().toLowerCase()
}

function splitSkillTerms(value: string) {
  return normalizeSkillTerm(value)
    .split(/(?:\/|／|、|，|,|;|；|\||\+|&|\s+(?:和|及|与|或|and|or)\s+)/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
}

function buildSkillTerms(value: string) {
  return [normalizeSkillTerm(value), ...splitSkillTerms(value)]
    .filter((term, index, terms) => term.length >= 2 && terms.indexOf(term) === index)
}

function includesAny(values: string[], candidates: string[]) {
  const valueTerms = values.flatMap(buildSkillTerms)
  const candidateTerms = candidates.flatMap(buildSkillTerms)

  return candidateTerms.some((candidate) => {
    return valueTerms.some((value) => {
      return value.includes(candidate) || candidate.includes(value)
    })
  })
}

const weaknessEvidenceTypes = new Set(['direct_missing', 'implicit_evidence', 'wording_gap'])
const matchGapPriorities = new Set(['high', 'medium', 'low'])

function resolveSourcePathValue(sourceResume: ResumeStructure, sourcePath: string) {
  const normalizedPath = sourcePath
    .trim()
    .replace(/^(?:structured_source_resume|structured_resume)\./, '')
  const segments = normalizedPath.match(/[^.[\]]+/g) ?? []
  let current: unknown = sourceResume

  for (const segment of segments) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)]
      continue
    }

    if (current && typeof current === 'object' && segment in current) {
      current = (current as Record<string, unknown>)[segment]
      continue
    }

    return undefined
  }

  return typeof current === 'string' ? current : undefined
}

export function evaluateResumeAnalysisBusiness(analysis: ResumeAnalysis): EvaluationResult {
  const issues: EvaluationIssue[] = []
  const resume = analysis.structured_resume

  if (!hasText(analysis.capability_summary)) {
    issues.push({
      severity: 'error',
      code: 'MISSING_CAPABILITY_SUMMARY',
      message: '简历分析缺少候选人能力总结。',
      path: 'capability_summary',
    })
  }

  if (!hasItems(analysis.strengths)) {
    issues.push({
      severity: 'warning',
      code: 'MISSING_ANALYSIS_STRENGTHS',
      message: '简历分析缺少优势列表。',
      path: 'strengths',
    })
  }

  if (!hasItems(analysis.suggestions)) {
    issues.push({
      severity: 'warning',
      code: 'MISSING_ANALYSIS_SUGGESTIONS',
      message: '简历分析缺少优化建议。',
      path: 'suggestions',
    })
  }

  if (!hasText(resume.personal_info?.name)) {
    issues.push({
      severity: 'error',
      code: 'MISSING_PERSON_NAME',
      message: '结构化简历缺少姓名。',
      path: 'structured_resume.personal_info.name',
    })
  }

  if (!hasItems(resume.experience)) {
    issues.push({
      severity: 'error',
      code: 'MISSING_SOURCE_EXPERIENCE',
      message: '结构化简历缺少工作经历。',
      path: 'structured_resume.experience',
    })
  }

  if (!hasItems(resume.skills?.hard_skills)) {
    issues.push({
      severity: 'error',
      code: 'MISSING_HARD_SKILLS',
      message: '结构化简历缺少硬技能。',
      path: 'structured_resume.skills.hard_skills',
    })
  }

  return buildResult({ evaluatorName: 'resume-analysis-business-rules', issues })
}

export function evaluateMatchAnalysisBusiness(
  matchAnalysis: MatchAnalysis,
  sourceResume?: ResumeStructure
): EvaluationResult {
  const issues: EvaluationIssue[] = []
  const requiredSkills = getRequiredSkills(matchAnalysis.jd_structure)
  const weaknessDetails = matchAnalysis.weakness_details ?? []
  const strategyDetails = matchAnalysis.optimization_strategy_details ?? []

  if (matchAnalysis.match_score < 0 || matchAnalysis.match_score > 100) {
    issues.push({
      severity: 'error',
      code: 'MATCH_SCORE_OUT_OF_RANGE',
      message: '岗位匹配分数必须在 0-100 之间。',
      path: 'match_score',
    })
  }

  if (!hasText(matchAnalysis.experience_match)) {
    issues.push({
      severity: 'error',
      code: 'MISSING_EXPERIENCE_MATCH',
      message: '匹配分析缺少经验匹配说明。',
      path: 'experience_match',
    })
  }

  if (!hasItems(matchAnalysis.strengths)) {
    issues.push({
      severity: 'warning',
      code: 'MISSING_MATCH_STRENGTHS',
      message: '匹配分析缺少优势点。',
      path: 'strengths',
    })
  }

  if (hasItems(matchAnalysis.weaknesses)) {
    if (weaknessDetails.length !== matchAnalysis.weaknesses.length) {
      issues.push({
        severity: 'error',
        code: 'MISSING_WEAKNESS_EVIDENCE_TYPE',
        message: '每条岗位匹配弱点都必须提供证据类型标注。',
        path: 'weakness_details',
      })
    }

    weaknessDetails.forEach((detail, index) => {
      if (!weaknessEvidenceTypes.has(detail.evidence_type)) {
        issues.push({
          severity: 'error',
          code: 'INVALID_WEAKNESS_EVIDENCE_TYPE',
          message: '弱点证据类型必须是 direct_missing、implicit_evidence 或 wording_gap。',
          path: `weakness_details.${index}.evidence_type`,
        })
      }

      if (!hasText(detail.weakness) || !hasText(detail.evidence) || !hasText(detail.suggestion)) {
        issues.push({
          severity: 'warning',
          code: 'INCOMPLETE_WEAKNESS_EVIDENCE_DETAIL',
          message: '弱点证据标注建议包含弱点描述、判断依据和改写建议。',
          path: `weakness_details.${index}`,
        })
      }

      if (
        detail.id !== `G${index + 1}` ||
        !detail.priority ||
        !matchGapPriorities.has(detail.priority) ||
        !hasText(detail.jd_requirement) ||
        !hasText(detail.impact)
      ) {
        issues.push({
          severity: 'error',
          code: 'INCOMPLETE_STRUCTURED_GAP',
          message: '每条岗位差距都必须包含连续 G 编号、优先级、JD 要求、判断依据、投递影响和应对方向。',
          path: `weakness_details.${index}`,
        })
      }
    })
  }

  const gapIds = new Set(weaknessDetails.map((detail) => detail.id).filter(hasText))
  const actionableGapIds = weaknessDetails
    .filter((detail) => detail.evidence_type !== 'direct_missing')
    .map((detail) => detail.id)
    .filter((id): id is string => hasText(id))

  if (actionableGapIds.length > 0 && strategyDetails.length === 0) {
    issues.push({
      severity: 'error',
      code: 'MISSING_OPTIMIZATION_STRATEGY_DETAILS',
      message: '可由现有证据解决的岗位差距必须提供结构化优化策略和改写实例。',
      path: 'optimization_strategy_details',
    })
  }

  if (hasItems(matchAnalysis.optimization_suggestions) && strategyDetails.length === 0) {
    issues.push({
      severity: 'error',
      code: 'UNSTRUCTURED_OPTIMIZATION_SUGGESTIONS',
      message: '优化建议必须提供策略说明以及可回溯的优化前后实例，不能只返回字符串摘要。',
      path: 'optimization_strategy_details',
    })
  }

  const coveredGapIds = new Set<string>()
  strategyDetails.forEach((detail, index) => {
    const example = detail.optimization_example
    const relatedGapIds = detail.related_gap_ids ?? []
    const hasInvalidGapReference = relatedGapIds.length === 0 || relatedGapIds.some((gapId) => {
      const referencedGap = weaknessDetails.find((gap) => gap.id === gapId)
      return !gapIds.has(gapId) || referencedGap?.evidence_type === 'direct_missing'
    })

    relatedGapIds.forEach((gapId) => coveredGapIds.add(gapId))

    if (
      detail.id !== `S${index + 1}` ||
      !hasText(detail.strategy_point) ||
      !hasText(detail.rationale) ||
      hasInvalidGapReference ||
      !hasText(example?.source_path) ||
      !hasText(example?.source_quote) ||
      !hasText(example?.optimized_content)
    ) {
      issues.push({
        severity: 'error',
        code: 'INCOMPLETE_OPTIMIZATION_STRATEGY_DETAIL',
        message: '每条优化策略都必须包含连续 S 编号、可行动差距关联、策略点、说明以及完整的优化前后实例。',
        path: `optimization_strategy_details.${index}`,
      })
      return
    }

    if (sourceResume) {
      const originalValue = resolveSourcePathValue(sourceResume, example.source_path)
      if (!originalValue || originalValue.trim() !== example.source_quote.trim()) {
        issues.push({
          severity: 'error',
          code: 'INVALID_OPTIMIZATION_SOURCE_QUOTE',
          message: '优化前原文必须逐字来自 source_path 指向的单个源简历字段。',
          path: `optimization_strategy_details.${index}.optimization_example`,
        })
      }
    }
  })

  const uncoveredGapIds = actionableGapIds.filter((gapId) => !coveredGapIds.has(gapId))
  if (uncoveredGapIds.length > 0) {
    issues.push({
      severity: 'error',
      code: 'ACTIONABLE_GAP_WITHOUT_STRATEGY',
      message: `以下可行动差距没有对应优化策略：${uncoveredGapIds.join('、')}。`,
      path: 'optimization_strategy_details',
    })
  }

  if (requiredSkills.length > 0) {
    const requiredSkillChecks = matchAnalysis.skill_match.required_skill_checks ?? []
    const checkedSkills = requiredSkillChecks.length > 0
      ? requiredSkillChecks.map((check) => check.requirement)
      : [...matchAnalysis.skill_match.matched, ...matchAnalysis.skill_match.missing]
    const uncheckedSkills = requiredSkills.filter((skill) => !includesAny(checkedSkills, [skill]))
    if (uncheckedSkills.length > 0) {
      issues.push({
        severity: 'warning',
        code: 'JD_REQUIRED_SKILLS_NOT_CHECKED',
        message: `匹配分析未逐项覆盖 JD 必备技能（${uncheckedSkills.length} 项），将影响评分和后续建议，不阻断流程。`,
        path: requiredSkillChecks.length > 0 ? 'skill_match.required_skill_checks' : 'skill_match',
      })
    }
  }

  if (!matchAnalysis.jd_structure?.basic_info?.title) {
    issues.push({
      severity: 'error',
      code: 'MISSING_JD_TITLE',
      message: '匹配分析结果缺少岗位标题。',
      path: 'jd_structure.basic_info.title',
    })
  }

  return buildResult({ evaluatorName: 'match-analysis-business-rules', issues })
}

export function evaluateInterviewSuggestionsBusiness(suggestions: InterviewSuggestions): EvaluationResult {
  const issues: EvaluationIssue[] = []

  if (suggestions.questions.length < 3) {
    issues.push({
      severity: 'warning',
      code: 'INSUFFICIENT_INTERVIEW_QUESTIONS',
      message: '面试建议问题数量少于 3 个。',
      path: 'questions',
    })
  }

  if (!hasItems(suggestions.story_recommendations)) {
    issues.push({
      severity: 'error',
      code: 'MISSING_STORY_RECOMMENDATIONS',
      message: '面试建议缺少故事/项目准备建议。',
      path: 'story_recommendations',
    })
  }

  if (!hasItems(suggestions.follow_up_questions)) {
    issues.push({
      severity: 'warning',
      code: 'MISSING_FOLLOW_UP_QUESTIONS',
      message: '面试建议缺少反问问题。',
      path: 'follow_up_questions',
    })
  }

  const storyWithMissingFields = suggestions.story_recommendations.find(
    (story) => (
      !hasText(story.title)
      || !hasText(story.background)
      || !hasText(story.result)
      || !hasItems(story.storytelling_approach)
      || story.storytelling_approach.filter(hasText).length < 2
      || story.storytelling_approach.filter(hasText).length > 3
    )
  )
  if (storyWithMissingFields) {
    issues.push({
      severity: 'error',
      code: 'INCOMPLETE_STORY_RECOMMENDATION',
      message: '面试故事建议的标题、背景、结果或讲述思路不完整。',
      path: 'story_recommendations',
    })
  }

  return buildResult({ evaluatorName: 'interview-suggestions-business-rules', issues })
}

export function evaluateSourceResumeForGeneration(sourceResume: ResumeStructure): EvaluationResult {
  const issues: EvaluationIssue[] = []

  if (!hasItems(sourceResume.experience)) {
    issues.push({
      severity: 'error',
      code: 'MISSING_SOURCE_EXPERIENCE',
      message: '生成优化简历前，源简历必须包含工作经历。',
      path: 'experience',
    })
  }

  if (!hasItems(sourceResume.skills?.hard_skills)) {
    issues.push({
      severity: 'error',
      code: 'MISSING_SOURCE_HARD_SKILLS',
      message: '生成优化简历前，源简历必须包含硬技能。',
      path: 'skills.hard_skills',
    })
  }

  return buildResult({ evaluatorName: 'source-resume-generation-precheck', issues })
}
