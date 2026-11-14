import { strategyResultExcerpts } from '@/shared/resume-strategy'
import { deliveredResumeMarkdown } from '@/v5/delivery-markdown'
import { calculateExperienceDuration } from '@/v5/experience-duration'
import {changeManifestDescriptions} from '@/shared/resume-actions'
import {educationFields, isEducationIdentityOnly} from '@/v5/writing/education'
import {timelineRoleTitle} from '@/v5/composition/timeline-display'
import {buildInterviewPresentation} from '@/v5/interview-presentation'
import {projectInterviewKnownResult} from '@/v5/interview-results'

import type {
  InterviewSuggestions,
  JDStructure,
  MatchAnalysis,
  MvpProcessResponse,
  ResumeAnalysis,
  ResumeStructure,
} from '@/types'
import { isV5ProductDeliverable } from '@/v5/delivery-gate'
import { V5WorkflowBlockedError } from '@/v5/errors'
import type { EvidenceAtom, InterviewPreparation, ValidationIssue, V5WorkflowResult } from '@/v5/types'

function deliveryIssueCodes(result: V5WorkflowResult) {
  const issues = Array.isArray(result.validationIssues) ? result.validationIssues : []
  return [...new Set(issues
    .filter(item => item?.severity !== 'info' && typeof item?.code === 'string')
    .map(item => item.code))]
}

function sanitizedDeliveryIssues(result: V5WorkflowResult): ValidationIssue[] {
  return deliveryIssueCodes(result).map((code, index) => ({
    issueId: `delivery_gate_${index + 1}`,
    severity: 'error',
    code,
    outputPath: null,
    claimId: null,
    evidenceIds: [],
    requirementIds: [],
    message: '产物未通过交付质量门禁。',
    expectedConstraint: '仅交付所有确定性产品质量门禁均通过的结果。',
    replacementText: null,
  }))
}

function scopeEvidence(result: Pick<V5WorkflowResult, 'resumeEvidenceBundle'>, scopeId: string) {
  return result.resumeEvidenceBundle.evidenceAtoms.filter(atom => (
    atom.sourceScopeId === scopeId && atom.status !== 'excluded'
  ))
}

function factText(atoms: EvidenceAtom[], types: EvidenceAtom['claimType'][]) {
  return atoms
    .filter(atom => types.includes(atom.claimType))
    .map(atom => atom.normalizedClaim || atom.verbatimText)
}

function toResumeStructure(result: Pick<V5WorkflowResult, 'resumeEvidenceBundle'>): ResumeStructure {
  const { identity, timeline, evidenceAtoms } = result.resumeEvidenceBundle
  const experience = timeline.filter(item => item.kind === 'experience' || item.kind === 'internship')
  const education = timeline.filter(item => item.kind === 'education')
  const projects = timeline.filter(item => item.kind === 'project' || item.kind === 'research')
  const skills = evidenceAtoms
    .filter(atom => atom.claimType === 'skill' && atom.status !== 'excluded')
    .map(atom => atom.normalizedClaim || atom.verbatimText)

  return {
    personal_info: {
      name: identity.name.value ?? '',
      email: identity.email.value ?? undefined,
      phone: identity.phone.value ?? undefined,
      location: identity.cityLevelLocation.value ?? undefined,
      current_position: experience[0]?.title ?? undefined,
    },
    education: education.map(item => ({
      school: item.organization ?? '',
      ...educationFields(item.title),
      time_range: [item.start, item.end].filter(Boolean).join(' - '),
      achievements: factText(scopeEvidence(result, item.scopeId).filter(atom => !isEducationIdentityOnly(atom, item)), ['education', 'result', 'award']),
    })),
    experience: experience.map(item => {
      const atoms = scopeEvidence(result, item.scopeId)
      return {
        company: item.organization ?? '',
        position: timelineRoleTitle(item) ?? '',
        time_range: [item.start, item.end].filter(Boolean).join(' - '),
        responsibilities: factText(atoms, ['responsibility', 'action', 'deliverable']),
        achievements: factText(atoms, ['result', 'award']),
      }
    }),
    projects: projects.map(item => {
      const atoms = scopeEvidence(result, item.scopeId)
      const projectSkills = factText(atoms, ['skill'])
      return {
        name: item.organization ?? item.title ?? '',
        role: item.title ?? '',
        tech_stack: projectSkills,
        description: factText(atoms, ['responsibility', 'action', 'deliverable'])[0] ?? '',
        achievements: factText(atoms, ['result', 'award']),
      }
    }),
    skills: { hard_skills: [...new Set(skills)] },
  }
}

export function toResumeAnalysis(result: Pick<V5WorkflowResult, 'resumeEvidenceBundle'>): ResumeAnalysis {
  const assessment = result.resumeEvidenceBundle.qualityAssessment
  return {
    quality_score: assessment.score,
    strengths: assessment.strengths.map(item => item.statement),
    weaknesses: assessment.weaknesses.map(item => item.statement),
    suggestions: assessment.suggestions.map(item => item.statement),
    capability_summary: assessment.capabilitySummary,
    structured_resume: toResumeStructure(result),
  }
}

function toJdStructure(result: Pick<V5WorkflowResult, 'jobRequirementBundle'>): JDStructure {
  const { jobRequirementBundle: job } = result
  const byCategory = (category: string) => job.requirementAtoms
    .filter(atom => atom.category === category)
    .map(atom => atom.normalizedRequirement)
  return {
    requirement_sources: job.requirementAtoms.map(atom => ({requirement_id: atom.requirementId,
      source_quote: atom.verbatimText, source_span: {...atom.sourceSpan}, source_block_id: atom.sourceBlockId})),
    basic_info: {
      title: job.basicInfo.title ?? '',
      company: job.basicInfo.company ?? undefined,
      location: job.basicInfo.location ?? undefined,
    },
    hard_requirements: {
      education: byCategory('education')[0],
      experience_years: byCategory('experience')[0],
      required_skills: job.requirementAtoms.filter(atom => atom.category === 'skill'
        && atom.semantics?.condition !== 'preferred' && atom.importance !== 'nice_to_have').map(atom => atom.normalizedRequirement),
    },
    responsibilities: byCategory('responsibility'),
    tasks: [...byCategory('outcome'), ...byCategory('other')],
    soft_skills: [],
    nice_to_have: job.requirementAtoms
      .filter(atom => atom.semantics ? atom.semantics.condition === 'preferred' : atom.importance === 'nice_to_have' || atom.importance === 'differentiator')
      .map(atom => atom.normalizedRequirement),
    requirement_hierarchy: {
      must_have: job.requirementAtoms.filter(atom => atom.semantics ? atom.semantics.condition === 'required' : atom.importance === 'must_have').map(atom => atom.normalizedRequirement),
      core_outcomes: job.requirementAtoms.filter(atom => atom.semantics ? atom.semantics.condition === 'expected' : atom.importance === 'core_outcome').map(atom => atom.normalizedRequirement),
      differentiators: job.requirementAtoms.filter(atom => atom.semantics ? atom.semantics.condition === 'preferred' : atom.importance === 'differentiator').map(atom => atom.normalizedRequirement),
    },
    company_context: {
      explicit_signals: job.explicitCompanySignals,
      inferred_talent_preferences: [],
      inference_basis: [],
      confidence: job.explicitCompanySignals.length > 0 ? 'high' : 'unknown',
    },
    location_context: {
      explicit_signals: job.explicitLocationSignals,
      inferred_role_implications: [],
      inference_basis: [],
      confidence: job.explicitLocationSignals.length > 0 ? 'high' : 'unknown',
    },
    uncertainties: job.uncertainties,
  }
}

/** Keep the explanatory profile on the same source-owned condition axis as JD lists. */
export function alignRequirementAnalysisStrengths(analysis: V5WorkflowResult['requirementAnalysis'], job: V5WorkflowResult['jobRequirementBundle']) {
  if (!analysis) return undefined
  return {...analysis, externalRequirements: analysis.externalRequirements.map(item => {
    const sources = job.requirementAtoms.filter(atom => item.sourceQuotes.includes(atom.verbatimText))
    if (!sources.length) return job.requirementAtoms.some(atom => atom.semantics) ? {...item, strength: 'unspecified' as const} : item
    if (sources.every(atom => !atom.semantics)) return item
    const conditions = new Set(sources.map(atom => atom.semantics?.condition ?? 'unclear'))
    const condition = conditions.size === 1 ? [...conditions][0] : 'unclear'
    return {...item, strength: condition === 'required' ? 'necessary' as const
      : condition === 'preferred' ? 'preferred' as const : 'unspecified' as const}
  })}
}

export function toMatchAnalysis(result: Pick<V5WorkflowResult, 'resumeEvidenceBundle' | 'jobRequirementBundle' | 'matchAnalysis' | 'matchScore' | 'requirementAnalysis'>): MatchAnalysis {
  const requirement = new Map(result.jobRequirementBundle.requirementAtoms.map(atom => [atom.requirementId, atom]))
  const evidence = new Map(result.resumeEvidenceBundle.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const judgments = new Map(result.matchAnalysis.judgmentBundle?.items.map(item => [item.requirementId, item]) ?? [])
  const statusFor = (id: string) => {
    const judgment = judgments.get(id)
    if (judgment) return judgment.conflict ? 'unproven' as const : judgment.status
    const old = result.matchAnalysis.requirementMatches.find(item => item.requirementId === id)
    return old?.status === 'direct_match' ? 'direct' as const : old?.status === 'transferable_match' ? 'transferable_or_partial' as const : 'unproven' as const
  }
  const direct = result.matchAnalysis.requirementMatches.filter(item => statusFor(item.requirementId) === 'direct')
  const missing = result.matchAnalysis.requirementMatches.filter(item => statusFor(item.requirementId) === 'not_met')
  const duration = calculateExperienceDuration(result.resumeEvidenceBundle)
  const experienceSummary = duration.fullTime.months === null
    ? `全职任职已有可核对区间并集${duration.fullTime.knownLowerBoundMonths}个月；完整年限仍需核对任职月份与材料时点。`
    : `全职任职时间并集${duration.fullTime.months}个月；相关性仍按各项岗位要求核验。`
  const internshipSummary = duration.internship.scopeIds.length
    ? duration.internship.months === null ? '实习时间单独记录，部分日期待核对，不与全职直接相加。' : `实习时间并集${duration.internship.months}个月，单独计算。` : ''
  const jd = toJdStructure(result)
  return {
    match_score: result.matchScore.score,
    score_formula_version: result.matchScore.formulaVersion,
    ...(result.matchScore.metadata?.scoreBasis ? {score_basis: result.matchScore.metadata.scoreBasis, score_confidence: result.matchScore.confidence} : {}),
    ...(result.matchAnalysis.judgmentBundle ? {requirement_judgments: result.matchAnalysis.judgmentBundle} : {}),
    experience_duration: duration,
    ...(result.matchScore.metadata?.calibrationStatus ? {score_calibration_status: result.matchScore.metadata.calibrationStatus} : {}),
    ...(result.matchAnalysis.actionPlan ? {action_plan: result.matchAnalysis.actionPlan} : {}),
    ...(result.requirementAnalysis ? { requirement_analysis: alignRequirementAnalysisStrengths(result.requirementAnalysis, result.jobRequirementBundle) } : {}),
    hard_requirements_match: Object.fromEntries(result.matchAnalysis.requirementMatches.map(item => [
      requirement.get(item.requirementId)?.normalizedRequirement ?? item.requirementId,
      statusFor(item.requirementId) === 'direct' ? true : statusFor(item.requirementId) === 'not_met' ? false : null,
    ])),
    skill_match: {
      matched: direct
        .filter(item => requirement.get(item.requirementId)?.category === 'skill')
        .map(item => requirement.get(item.requirementId)?.normalizedRequirement ?? item.requirementId),
      missing: missing
        .filter(item => requirement.get(item.requirementId)?.category === 'skill')
        .map(item => requirement.get(item.requirementId)?.normalizedRequirement ?? item.requirementId),
      required_skill_checks: result.jobRequirementBundle.requirementAtoms
        .filter(atom => atom.category === 'skill')
        .map(atom => {
          const match = result.matchAnalysis.requirementMatches.find(item => item.requirementId === atom.requirementId)
          return {
            requirement: atom.verbatimText,
            status: statusFor(atom.requirementId) === 'direct' ? 'matched' as const
              : statusFor(atom.requirementId) === 'transferable_or_partial' ? 'partial' as const
                : statusFor(atom.requirementId) === 'not_met' ? 'not_met' as const : 'unproven' as const,
            evidence: match?.rationale ?? '当前材料未完成该要求的核验。',
          }
        }),
    },
    experience_match: experienceSummary + internshipSummary,
    soft_skills_match: '仅基于当前材料和目标岗位显式要求评估。',
    strengths: result.matchAnalysis.strengths.map(item => item.statement),
    weaknesses: result.matchAnalysis.gaps.map(item => item.impact),
    weakness_details: result.matchAnalysis.gaps.map(gap => ({
      id: gap.gapId,
      priority: gap.priority,
      is_required: gap.requirementIds.some(id => {
        const item = requirement.get(id)
        return item?.importance === 'must_have' && item.explicitness === 'explicit'
          && ['education', 'experience', 'skill', 'language', 'certification', 'location', 'schedule'].includes(item.category)
      }),
      weakness: gap.impact,
      evidence_type: gap.evidenceType,
      jd_requirement: [...new Set(gap.requirementIds.map(id => requirement.get(id)?.verbatimText ?? id))].join('；'),
      evidence: gap.evidenceIds.map(id => evidence.get(id)?.verbatimText ?? id).join('；'),
      impact: gap.impact,
      suggestion: gap.safeHandling,
    })),
    positioning_strategy: result.matchAnalysis.positioning.statement,
    optimization_suggestions: result.matchAnalysis.gaps.map(item => item.safeHandling),
    optimization_strategy_details: result.matchAnalysis.gaps.map(gap => ({
      id: `strategy_${gap.gapId}`,
      related_gap_ids: [gap.gapId],
      strategy_point: gap.safeHandling,
      rationale: gap.impact,
      optimization_example: {
        source_path: '',
        source_quote: gap.evidenceIds.flatMap(id => evidence.get(id)?.verbatimText ?? []).join('；'),
        // Matching proposes an edit; only the final artifact can demonstrate its execution.
        optimized_content: '',
      },
    })),
    context_fit: {
      company_alignment: jd.company_context?.explicit_signals.join('；') || '未使用无来源公司推断',
      location_alignment: jd.location_context?.explicit_signals.join('；') || '未使用无来源地域推断',
      hypotheses_used: result.matchAnalysis.contextUsed.map(item => item.effect),
    },
    jd_structure: jd,
  }
}

function toInterviewSuggestions(result: V5WorkflowResult): InterviewSuggestions | undefined {
  if (result.deliveryDiagnostics.provenance.interview !== 'generated') return undefined
  const preparation = result.interviewPreparation
  if (!preparation) return undefined
  return toInterviewPreparation(preparation, result)
}

export function toInterviewPreparation(preparation: InterviewPreparation, snapshot?: Pick<V5WorkflowResult, 'resumeEvidenceBundle' | 'jobRequirementBundle' | 'matchAnalysis' | 'resolvedActionPlan' | 'preparationTopics' | 'completionDocument'>, options?: {sourceText?: string}): InterviewSuggestions {
  const document = snapshot?.completionDocument
  const basedOnDocument = document ? {documentId: document.documentId, revision: document.revision,
    ...(snapshot?.resolvedActionPlan?.resolvedDigest ? {resolvedDigest: snapshot.resolvedActionPlan.resolvedDigest} : {})} : undefined
  const presentation = snapshot ? buildInterviewPresentation(preparation, snapshot, {...options, basedOnDocument}) : undefined
  return {
    ...(presentation ? {presentation} : {}),
    preparation_topics: snapshot?.preparationTopics ?? [],
    questions: preparation.questions.map(item => item.question),
    story_recommendations: preparation.storyRecommendations.map((item, index) => ({
      title: item.title,
      ...(presentation ? {story_id: presentation.stories[index]?.storyId, scope_id: item.scopeId,
        case_group_id: presentation.stories[index]?.caseGroupId} : {}),
      ...(snapshot ? {source_references: item.evidenceIds.flatMap(id => {
        const atom = snapshot.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.evidenceId === id && atom.status !== 'excluded')
        return atom ? [{evidence_id: id, source_scope_id: atom.sourceScopeId, source_quote: atom.verbatimText,
          source_kind: atom.provenance?.kind === 'user_edit' ? 'user_fact' as const : 'source_resume' as const}] : []
      }), related_requirement_ids: presentation?.stories[index]?.jobReferences.map(reference => reference.requirementId) ?? [],
      action_ids: snapshot.resolvedActionPlan?.actions.filter(action => action.evidenceIds.some(id => item.evidenceIds.includes(id))).map(action => action.actionId) ?? []} : {}),
      background: item.background,
      result: item.knownResult && snapshot ? projectInterviewKnownResult(item.knownResult, item.evidenceIds, snapshot.resumeEvidenceBundle.evidenceAtoms, options?.sourceText)
        : item.knownResult ?? `待核实：${item.preparationGap ?? '结果证据不足'}`,
      storytelling_approach: item.storytellingApproach ?? [],
    })),
    follow_up_questions: preparation.followUpQuestions.map(item => item.question),
  }
}

export function toLegacyMvpProcessResponse(result: V5WorkflowResult): MvpProcessResponse {
  if (!isV5ProductDeliverable(result)) {
    const blocked = new V5WorkflowBlockedError({
      code: 'V5_PRODUCT_QUALITY_BLOCKED',
      state: 'blocked_quality_validation',
      message: '本次结果未达到可投递质量标准，已停止交付。',
      issues: sanitizedDeliveryIssues(result),
    })
    blocked.runId = result.runId
    throw blocked
  }
  return {
    run_id: result.runId,
    workflow_status: 'succeeded',
    agent_version: '6.0.0',
    agent_state: result.state,
    release_status: result.releaseStatus,
    used_safe_fallback: result.usedSafeFallback,
    step1_analysis: toResumeAnalysis(result),
    step2_matching: toMatchAnalysis(result),
    step3_optimized_resume: deliveredResumeMarkdown(result),
    ...(result.completionDocument ? {step3_completion_document: result.completionDocument} : {}),
    step3_strategy_review: result.strategyReview,
    ...(result.actionPlan ? {step3_action_plan: result.actionPlan} : {}),
    ...(result.resolvedActionPlan ? {step3_resolved_action_plan: result.resolvedActionPlan} : {}),
    ...(result.actionReview ? {step3_action_review: result.actionReview} : {}),
    ...(result.changeManifest ? {step3_change_manifest: result.changeManifest} : {}),
    ...(result.identityState ? {step3_identity_state: result.identityState} : {}),
    ...(result.deliveryState ? {step3_delivery_state: result.deliveryState} : {}),
    step3_changes_summary: result.changeManifest ? changeManifestDescriptions(result.changeManifest)
      : strategyResultExcerpts(result.strategyReview, deliveredResumeMarkdown(result)),
    step4_interview_suggestions: toInterviewSuggestions(result),
  }
}
