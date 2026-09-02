import type {
  InterviewSuggestions,
  JDStructure,
  MatchAnalysis,
  MvpProcessResponse,
  ResumeAnalysis,
  ResumeStructure,
} from '@/types'
import type { EvidenceAtom, V5WorkflowResult } from '@/v5/types'

function scopeEvidence(result: V5WorkflowResult, scopeId: string) {
  return result.resumeEvidenceBundle.evidenceAtoms.filter(atom => (
    atom.sourceScopeId === scopeId && atom.status !== 'excluded'
  ))
}

function factText(atoms: EvidenceAtom[], types: EvidenceAtom['claimType'][]) {
  return atoms
    .filter(atom => types.includes(atom.claimType))
    .map(atom => atom.normalizedClaim || atom.verbatimText)
}

function toResumeStructure(result: V5WorkflowResult): ResumeStructure {
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
      major: '',
      degree: item.title ?? '',
      time_range: [item.start, item.end].filter(Boolean).join(' - '),
      achievements: factText(scopeEvidence(result, item.scopeId), ['education', 'result', 'award']),
    })),
    experience: experience.map(item => {
      const atoms = scopeEvidence(result, item.scopeId)
      return {
        company: item.organization ?? '',
        position: item.title ?? '',
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

function toResumeAnalysis(result: V5WorkflowResult): ResumeAnalysis {
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

function toJdStructure(result: V5WorkflowResult): JDStructure {
  const { jobRequirementBundle: job } = result
  const byCategory = (category: string) => job.requirementAtoms
    .filter(atom => atom.category === category)
    .map(atom => atom.normalizedRequirement)
  return {
    basic_info: {
      title: job.basicInfo.title ?? '',
      company: job.basicInfo.company ?? undefined,
      location: job.basicInfo.location ?? undefined,
    },
    hard_requirements: {
      education: byCategory('education')[0],
      experience_years: byCategory('experience')[0],
      required_skills: byCategory('skill'),
    },
    responsibilities: byCategory('responsibility'),
    tasks: [...byCategory('outcome'), ...byCategory('other')],
    soft_skills: [],
    nice_to_have: job.requirementAtoms
      .filter(atom => atom.importance === 'nice_to_have' || atom.importance === 'differentiator')
      .map(atom => atom.normalizedRequirement),
    requirement_hierarchy: {
      must_have: job.requirementAtoms.filter(atom => atom.importance === 'must_have').map(atom => atom.normalizedRequirement),
      core_outcomes: job.requirementAtoms.filter(atom => atom.importance === 'core_outcome').map(atom => atom.normalizedRequirement),
      differentiators: job.requirementAtoms.filter(atom => atom.importance === 'differentiator').map(atom => atom.normalizedRequirement),
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

function toMatchAnalysis(result: V5WorkflowResult): MatchAnalysis {
  const requirement = new Map(result.jobRequirementBundle.requirementAtoms.map(atom => [atom.requirementId, atom]))
  const evidence = new Map(result.resumeEvidenceBundle.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const direct = result.matchAnalysis.requirementMatches.filter(item => item.status === 'direct_match')
  const missing = result.matchAnalysis.requirementMatches.filter(item => item.status === 'currently_unproven')
  const jd = toJdStructure(result)
  return {
    match_score: result.matchScore.score,
    hard_requirements_match: Object.fromEntries(result.matchAnalysis.requirementMatches.map(item => [
      requirement.get(item.requirementId)?.normalizedRequirement ?? item.requirementId,
      item.status === 'direct_match' || item.status === 'transferable_match',
    ])),
    skill_match: {
      matched: direct
        .filter(item => requirement.get(item.requirementId)?.category === 'skill')
        .map(item => requirement.get(item.requirementId)?.normalizedRequirement ?? item.requirementId),
      missing: missing
        .filter(item => requirement.get(item.requirementId)?.category === 'skill')
        .map(item => requirement.get(item.requirementId)?.normalizedRequirement ?? item.requirementId),
    },
    experience_match: result.matchAnalysis.positioning.statement,
    soft_skills_match: '仅基于当前材料和目标岗位显式要求评估。',
    strengths: result.matchAnalysis.strengths.map(item => item.statement),
    weaknesses: result.matchAnalysis.gaps.map(item => item.impact),
    weakness_details: result.matchAnalysis.gaps.map(gap => ({
      id: gap.gapId,
      priority: gap.priority,
      weakness: gap.impact,
      evidence_type: gap.evidenceType,
      jd_requirement: gap.requirementIds.map(id => requirement.get(id)?.normalizedRequirement ?? id).join('；'),
      evidence: gap.evidenceIds.map(id => evidence.get(id)?.verbatimText ?? id).join('；'),
      impact: gap.impact,
      suggestion: gap.safeHandling,
    })),
    positioning_strategy: result.matchAnalysis.positioning.statement,
    optimization_suggestions: result.matchAnalysis.gaps.map(item => item.safeHandling),
    context_fit: {
      company_alignment: jd.company_context?.explicit_signals.join('；') || '未使用无来源公司推断',
      location_alignment: jd.location_context?.explicit_signals.join('；') || '未使用无来源地域推断',
      hypotheses_used: result.matchAnalysis.contextUsed.map(item => item.effect),
    },
    jd_structure: jd,
  }
}

function toInterviewSuggestions(result: V5WorkflowResult): InterviewSuggestions | undefined {
  const preparation = result.interviewPreparation
  if (!preparation) return undefined
  return {
    questions: preparation.questions.map(item => item.question),
    story_recommendations: preparation.storyRecommendations.map(item => ({
      title: item.title,
      background: item.background,
      result: item.knownResult ?? `待核实：${item.preparationGap ?? '结果证据不足'}`,
    })),
    follow_up_questions: preparation.followUpQuestions.map(item => item.question),
  }
}

export function toLegacyMvpProcessResponse(result: V5WorkflowResult): MvpProcessResponse {
  return {
    run_id: result.runId,
    workflow_status: 'succeeded',
    agent_version: '5.0.0',
    agent_state: result.state,
    release_status: result.releaseStatus,
    used_safe_fallback: result.usedSafeFallback,
    step1_analysis: toResumeAnalysis(result),
    step2_matching: toMatchAnalysis(result),
    step3_optimized_resume: result.artifact.markdown,
    step4_interview_suggestions: toInterviewSuggestions(result),
  }
}
