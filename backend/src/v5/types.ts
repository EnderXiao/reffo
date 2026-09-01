export const V5_SCHEMA_VERSION = '5.0.0' as const
export const V5_WORKFLOW_VERSION = '5.0.0-production-adaptive' as const
export const V5_VALIDATOR_VERSION = '5.0.0-validator-v2' as const
export const V5_ADAPTIVE_POLICY_VERSION = 'adaptive-v1' as const
export const V5_SCORE_FORMULA_VERSION = 'match-score-v1' as const

export type V5SchemaVersion = typeof V5_SCHEMA_VERSION
export type EvidenceStatus = 'source_supported' | 'source_qualified' | 'excluded'
export type AttributionLevel = 'owned' | 'drove' | 'contributed' | 'supported' | 'unspecified'
export type SourceScopeKind = 'experience' | 'internship' | 'project' | 'education' | 'research' | 'volunteer' | 'other'
export type EvidenceClaimType =
  | 'identity'
  | 'timeline'
  | 'responsibility'
  | 'action'
  | 'deliverable'
  | 'result'
  | 'skill'
  | 'education'
  | 'certification'
  | 'language'
  | 'award'
  | 'publication'
  | 'patent'
  | 'portfolio_link'
  | 'other'

export type EvidenceRiskFlag =
  | 'uncertain'
  | 'conflicting'
  | 'future_or_planned'
  | 'team_attribution'
  | 'self_assessment_only'
  | 'sensitive_pii'
  | 'prompt_injection_like_text'

export interface SourceBlock {
  sourceBlockId: string
  canonicalStart: number
  canonicalEnd: number
  text: string
  sectionHint: string | null
  inputRiskFlags: string[]
}

export interface CanonicalSourceDocument {
  documentId: string
  sha256: string
  primaryLanguage: string
  canonicalLength: number
  blocks: SourceBlock[]
}

export interface NumericAtom {
  raw: string
  valueText: string
  unit: string | null
  qualifier: string | null
  period: string | null
  ownerScope: string | null
}

export interface EvidenceAtom {
  evidenceId: string
  sourceDocumentHash: string
  sourceBlockId: string
  sourceScopeId: string
  sourceSpan: { start: number; end: number }
  verbatimText: string
  normalizedClaim: string
  claimType: EvidenceClaimType
  status: EvidenceStatus
  attributionLevel: AttributionLevel
  sourceActionVerb: string | null
  qualifiers: string[]
  numericAtoms: NumericAtom[]
  riskFlags: EvidenceRiskFlag[]
}

export interface ResumeExtractionCandidate {
  schemaVersion: V5SchemaVersion
  identityCandidates: Array<{
    field: 'name' | 'email' | 'phone' | 'city_level_location' | 'link'
    value: string
    factLocalIds: string[]
  }>
  timelineCandidates: Array<{
    scopeLocalId: string
    kind: SourceScopeKind
    organization: string | null
    title: string | null
    start: string | null
    end: string | null
    factLocalIds: string[]
  }>
  sectionCandidates: Array<{
    sectionLocalId: string
    type:
      | 'summary'
      | 'experience'
      | 'project'
      | 'education'
      | 'skills'
      | 'certifications'
      | 'languages'
      | 'awards'
      | 'publications'
      | 'patents'
      | 'research'
      | 'volunteer'
      | 'training'
      | 'portfolio'
      | 'custom'
    title: string
    scopeLocalIds: string[]
    factLocalIds: string[]
  }>
  factCandidates: Array<{
    factLocalId: string
    sourceBlockId: string
    blockRelativeSpan: { start: number; end: number }
    verbatimText: string
    normalizedClaim: string
    claimType: EvidenceClaimType
    sourceScopeLocalId: string
    proposedStatus: EvidenceStatus
    attributionLevel: AttributionLevel
    sourceActionVerb: string | null
    qualifiers: string[]
    numericAtoms: NumericAtom[]
    riskFlags: EvidenceRiskFlag[]
  }>
  unmappedFragments: Array<{
    sourceBlockId: string
    text: string
    reason: string
    importance: 'low' | 'medium' | 'high'
  }>
  conflicts: Array<{
    conflictLocalId: string
    factLocalIds: string[]
    description: string
    proposedResolution: 'exclude_conflicting_claim' | 'retain_with_qualifier' | 'needs_user_confirmation'
  }>
  coverageClaim: {
    mappedSourceBlockIds: string[]
    unmappedSourceBlockIds: string[]
  }
  qualityAssessment: {
    scoreInputs: {
      identityCompleteness: number
      timelineCompleteness: number
      evidenceResultDensity: number
      clarity: number
      sectionCoverage: number
    }
    strengths: Array<{ statement: string; factLocalIds: string[]; sourceBlockIds: string[] }>
    weaknesses: Array<{ statement: string; factLocalIds: string[]; sourceBlockIds: string[] }>
    suggestions: Array<{ statement: string; sourceBlockIds: string[] }>
    capabilitySummary: string
  }
}

export interface ResumeEvidenceBundle {
  schemaVersion: V5SchemaVersion
  sourceDocument: {
    documentId: string
    sha256: string
    primaryLanguage: string
  }
  identity: {
    name: { value: string | null; evidenceIds: string[] }
    email: { value: string | null; evidenceIds: string[] }
    phone: { value: string | null; evidenceIds: string[] }
    cityLevelLocation: { value: string | null; evidenceIds: string[] }
    links: Array<{ label: string; url: string; evidenceIds: string[] }>
  }
  timeline: Array<{
    scopeId: string
    kind: SourceScopeKind
    organization: string | null
    title: string | null
    start: string | null
    end: string | null
    evidenceIds: string[]
  }>
  sections: Array<{
    sectionId: string
    type: ResumeExtractionCandidate['sectionCandidates'][number]['type']
    title: string
    scopeIds: string[]
    evidenceIds: string[]
  }>
  evidenceAtoms: EvidenceAtom[]
  unmappedFragments: ResumeExtractionCandidate['unmappedFragments']
  conflicts: Array<{
    conflictId: string
    evidenceIds: string[]
    description: string
    resolution: 'exclude_conflicting_claim' | 'retain_with_qualifier' | 'needs_user_confirmation'
  }>
  extractionCoverage: {
    sourceBlockCount: number
    mappedBlockCount: number
    unmappedBlockCount: number
    coverageRatio: number
    highImportanceUnmappedCount: number
    warnings: string[]
  }
  qualityAssessment: ResumeExtractionCandidate['qualityAssessment'] & { score: number }
}

export type RequirementCategory =
  | 'education'
  | 'experience'
  | 'skill'
  | 'responsibility'
  | 'outcome'
  | 'language'
  | 'certification'
  | 'location'
  | 'schedule'
  | 'other'

export type RequirementImportance = 'must_have' | 'core_outcome' | 'differentiator' | 'nice_to_have'

export interface RequirementAtom {
  requirementId: string
  sourceBlockId: string
  sourceSpan: { start: number; end: number }
  verbatimText: string
  normalizedRequirement: string
  category: RequirementCategory
  importance: RequirementImportance
  logicGroupId: string | null
  logicOperator: 'and' | 'or' | 'one_of' | null
  explicitness: 'explicit' | 'semantic_summary'
}

export interface JobExtractionCandidate {
  schemaVersion: V5SchemaVersion
  basicInfo: { title: string | null; company: string | null; location: string | null }
  basicInfoSourceBlockIds: string[]
  requirementCandidates: Array<{
    requirementLocalId: string
    sourceBlockId: string
    blockRelativeSpan: { start: number; end: number }
    verbatimText: string
    normalizedRequirement: string
    category: RequirementCategory
    importance: RequirementImportance
    logicGroupLocalId: string | null
    logicOperator: 'and' | 'or' | 'one_of' | null
    explicitness: 'explicit' | 'semantic_summary'
  }>
  explicitCompanySignals: Array<{ statement: string; requirementLocalIds: string[] }>
  explicitLocationSignals: Array<{ statement: string; requirementLocalIds: string[] }>
  uncertainties: Array<{ statement: string; sourceBlockIds: string[] }>
  sourcedContextCandidates: JobRequirementBundle['sourcedContext']
  unmappedFragments: Array<{
    sourceBlockId: string
    text: string
    reason: string
    importance: 'low' | 'medium' | 'high'
  }>
  coverageClaim: { mappedSourceBlockIds: string[]; unmappedSourceBlockIds: string[] }
}

export interface JobRequirementBundle {
  schemaVersion: V5SchemaVersion
  basicInfo: { title: string | null; company: string | null; location: string | null }
  requirementAtoms: RequirementAtom[]
  explicitCompanySignals: string[]
  explicitLocationSignals: string[]
  uncertainties: string[]
  sourcedContext: Array<{
    contextId: string
    claim: string
    sourceUrl: string
    sourceTitle: string
    publishedOrRetrievedAt: string
    confidence: 'high' | 'medium' | 'low'
  }>
  extractionCoverage: {
    sourceBlockCount: number
    mappedBlockCount: number
    unmappedBlockCount: number
    coverageRatio: number
    highImportanceUnmappedCount: number
  }
}

export type RequirementMatchStatus =
  | 'direct_match'
  | 'transferable_match'
  | 'currently_unproven'
  | 'not_applicable'
  | 'conflicting_evidence'

export interface RequirementMatch {
  requirementId: string
  status: RequirementMatchStatus
  evidenceIds: string[]
  confidence: 'high' | 'medium' | 'low'
  rationale: string
}

export interface V5MatchAnalysis {
  schemaVersion: V5SchemaVersion
  requirementMatches: RequirementMatch[]
  strengths: Array<{
    strengthId: string
    requirementIds: string[]
    evidenceIds: string[]
    statement: string
  }>
  gaps: Array<{
    gapId: string
    requirementIds: string[]
    evidenceType: 'direct_missing' | 'implicit_evidence' | 'wording_gap'
    priority: 'high' | 'medium' | 'low'
    evidenceIds: string[]
    impact: string
    safeHandling: string
  }>
  positioning: {
    statement: string
    primaryRequirementIds: string[]
    primaryEvidenceIds: string[]
    forbiddenIdentityClaims: string[]
  }
  scoreInputs: {
    mustHaveApplicable: number
    mustHaveDirect: number
    mustHaveTransferable: number
    coreOutcomeApplicable: number
    coreOutcomeDirect: number
    coreOutcomeTransferable: number
    evidenceClarityRatio: number
  }
  contextUsed: Array<{ contextId: string; effect: string }>
}

export interface MatchScoreBreakdown {
  formulaVersion: typeof V5_SCORE_FORMULA_VERSION
  score: number
  label: 'based_on_current_material'
  confidence: 'high' | 'medium' | 'low'
  components: Array<{
    component: 'must_have' | 'core_outcome' | 'evidence_depth' | 'differentiator' | 'evidence_clarity'
    earned: number
    possible: number
    applicableCount: number
  }>
}

export interface ResumeStrategyProfile {
  profileVersion: typeof V5_ADAPTIVE_POLICY_VERSION
  careerStage: 'student_or_early' | 'experienced' | 'senior_or_leadership' | 'mixed' | 'unknown'
  evidenceShape: 'experience_led' | 'project_led' | 'research_led' | 'portfolio_led' | 'mixed'
  evidenceRichness: 'sparse' | 'standard' | 'rich'
  targetDistance: 'direct' | 'adjacent' | 'transition'
  outputLanguage: string
  confidence: 'high' | 'medium' | 'low'
  reasons: Array<{ signal: string; evidenceIds: string[]; requirementIds: string[] }>
  metrics: {
    eligibleBusinessEvidenceCount: number
    resultEvidenceCount: number
    experienceScopeCount: number
    projectScopeCount: number
    researchScopeCount: number
    portfolioEvidenceCount: number
    highImportanceUnmappedCount: number
  }
}

export interface GenerationPolicy {
  policyVersion: typeof V5_ADAPTIVE_POLICY_VERSION
  mode: 'preserve_sparse' | 'balanced_targeted' | 'selective_rich'
  sectionOrder: string[]
  summaryPolicy: 'omit_if_unsupported' | 'one_sentence' | 'one_to_two_sentences' | 'one_to_three_sentences'
  targetBusinessBulletMin: number
  targetBusinessBulletMax: number
  hardTotalListItemMax: number
  hardProjectMax: number
  stableCoreCoverageMin: number
  primaryRequirementCoverageMin: number
  preferredDirectEvidenceRatio: { min: number; max: number }
  outputLength: {
    unit: 'cjk_characters' | 'words'
    softMin: number | null
    softMax: number
    hardMax: number
  }
  fallbackPolicy: 'balanced_default' | 'source_preserving'
}

export interface StrategyResolution {
  schemaVersion: V5SchemaVersion
  selectedProfileId: string
  selectedPolicyId: string
  confidence: 'high' | 'medium' | 'low'
  basis: Array<{ statement: string; evidenceIds: string[]; requirementIds: string[] }>
}

export interface V5ResumePlan {
  schemaVersion: V5SchemaVersion
  strategyProfile: ResumeStrategyProfile
  generationPolicy: GenerationPolicy
  targetValueProposition: string
  primaryRequirementIds: string[]
  stableCoreEvidenceIds: string[]
  customizedEvidenceIds: string[]
  evidencePillars: Array<{
    pillarId: string
    title: string
    requirementIds: string[]
    evidenceIds: string[]
    role: 'career_anchor' | 'jd_primary' | 'jd_adjacent'
  }>
  scopePlans: Array<{
    scopeId: string
    scopeType: SourceScopeKind
    treatment: 'expand' | 'compress' | 'timeline_line' | 'include' | 'omit'
    selectedEvidenceIds: string[]
    bulletBudget: number
    rewriteAngle: string
  }>
  featuredSkillEvidenceIds: string[]
  safeKeywordMappings: Array<{ requirementId: string; evidenceIds: string[]; safePhrase: string }>
  forbiddenRequirementIds: string[]
  omittedHighValueEvidence: Array<{ evidenceId: string; reason: string }>
  lowerBoundException: string | null
}

export interface GeneratedResumeArtifact {
  schemaVersion: V5SchemaVersion
  markdown: string
  claims: Array<{
    claimId: string
    outputPath: string
    outputText: string
    evidenceIds: string[]
    transformation: 'verbatim' | 'compress' | 'reorder' | 'safe_paraphrase' | 'same_scope_merge'
    attributionLevel: AttributionLevel
  }>
  usedEvidenceIds: string[]
  omittedPlannedEvidenceIds: string[]
  renderStats: {
    businessBulletCount: number
    totalListItemCount: number
    projectCount: number
    cjkCharacterCount: number
    wordCount: number
  }
}

export interface ValidationIssue {
  issueId: string
  severity: 'error' | 'warning' | 'info'
  code: string
  outputPath: string | null
  claimId: string | null
  evidenceIds: string[]
  requirementIds: string[]
  message: string
  expectedConstraint: string
  replacementText: string | null
}

export interface ValidationResult<T = unknown> {
  passed: boolean
  issues: ValidationIssue[]
  value?: T
}

export interface BlockingFactJudgeResult {
  schemaVersion: V5SchemaVersion
  passed: boolean
  auditedClaimCount: number
  issues: Array<{
    issueId: string
    severity: 'error' | 'warning' | 'info'
    code:
      | 'unsupported_claim'
      | 'number_or_qualifier_change'
      | 'attribution_upgrade'
      | 'scope_migration'
      | 'stage_upgrade'
      | 'causality_invented'
      | 'jd_or_context_leak'
      | 'claim_mapping_insufficient'
      | 'writing_quality_only'
    claimId: string | null
    evidenceIds: string[]
    message: string
    safeRepairDirection: string
  }>
}

export interface InterviewPreparation {
  schemaVersion: V5SchemaVersion
  questions: Array<{
    question: string
    category: 'core_task' | 'project_deep_dive' | 'gap_or_transfer' | 'context_scenario'
    relatedRequirementIds: string[]
    relatedEvidenceIds: string[]
    preparationFocus: string
    assumptionContextIds: string[]
  }>
  storyRecommendations: Array<{
    title: string
    scopeId: string
    evidenceIds: string[]
    background: string
    knownResult: string | null
    preparationGap: string | null
  }>
  followUpQuestions: Array<{
    question: string
    purpose: string
    relatedRequirementIds: string[]
    assumptionContextIds: string[]
  }>
}

export interface ResumeQualityJudgeResult {
  schemaVersion: V5SchemaVersion
  evaluatorId: string
  dimensions: Array<{
    name:
      | 'job_specificity'
      | 'evidence_selection'
      | 'career_coherence'
      | 'result_expression'
      | 'conciseness_readability'
      | 'deliverability'
    score: number
    maxScore: number
    evidence: string[]
    issues: string[]
  }>
  deliverabilityGate: 'pass' | 'fail'
  factualIncidentCandidates: Array<{ severity: 'error' | 'warning'; claimId: string | null; message: string }>
}

export interface BlindABEvaluation {
  schemaVersion: V5SchemaVersion
  evaluations: Array<{
    candidateId: 'A' | 'B'
    absoluteGate: 'pass' | 'fail'
    dimensions: {
      factualFidelity: number
      jobSpecificity: number
      evidenceSelection: number
      highValueEvidenceRecall: number
      careerCoherence: number
      concisenessReadability: number
      deliverability: number
    }
    unsupportedClaims: string[]
    attributionErrors: string[]
    emptyScopes: string[]
    missingHighValueEvidence: string[]
    internalAuditLeaks: string[]
    strengths: string[]
    weaknesses: string[]
  }>
  pairwise: { winner: 'A' | 'B' | 'tie'; confidence: 'high' | 'medium' | 'low'; reason: string }
}

export interface PromptRunManifest {
  workflowVersion: string
  componentPromptId: string
  componentPromptVersion: string
  compiledPromptSha256: string
  schemaVersion: string
  validatorVersion: string
  adaptivePolicyVersion: string
  scoreFormulaVersion: string
  modelProvider: string
  modelSnapshot: string
  temperature: number
  inputDocumentIds: string[]
  startedAt: string
  durationMs: number
  inputTokens: number | null
  outputTokens: number | null
  repairAttempt: number
  promptFileSha256?: string
  promptFilePath?: string
}

export type ResumeAgentState =
  | 'received'
  | 'normalized'
  | 'resume_extracting'
  | 'resume_extracted'
  | 'job_extracting'
  | 'job_extracted'
  | 'matching'
  | 'matched'
  | 'policy_ready'
  | 'planning'
  | 'planned'
  | 'drafting'
  | 'drafted'
  | 'reviewing'
  | 'validating'
  | 'repairing_1'
  | 'repairing_2'
  | 'fact_judging'
  | 'succeeded'
  | 'succeeded_with_safe_fallback'
  | 'blocked_input_validation'
  | 'blocked_fact_validation'
  | 'blocked_structure_validation'
  | 'provider_failure'

export type V5ReleaseStatus = 'prompt_only_unverified' | 'preproduction_candidate' | 'production_reliable'

export interface V5ResumeExtractionResult {
  state: 'resume_extracted'
  releaseStatus: V5ReleaseStatus
  runId: string
  canonicalSourceDocument: CanonicalSourceDocument
  resumeExtractionCandidate: ResumeExtractionCandidate
  resumeEvidenceBundle: ResumeEvidenceBundle
}

export interface V5WorkflowResult {
  state: ResumeAgentState
  releaseStatus: V5ReleaseStatus
  runId: string
  resumeEvidenceBundle: ResumeEvidenceBundle
  jobRequirementBundle: JobRequirementBundle
  matchAnalysis: V5MatchAnalysis
  matchScore: MatchScoreBreakdown
  strategyProfile: ResumeStrategyProfile
  generationPolicy: GenerationPolicy
  resumePlan: V5ResumePlan
  artifact: GeneratedResumeArtifact
  interviewPreparation?: InterviewPreparation
  usedSafeFallback: boolean
  validationIssues: ValidationIssue[]
}

export interface V5StageEnvelope<TPayload> {
  schemaVersion: V5SchemaVersion
  runId: string
  workflowVersion: typeof V5_WORKFLOW_VERSION
  payload: TPayload
}
