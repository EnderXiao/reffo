import { z } from 'zod'
import { V5_ADAPTIVE_POLICY_VERSION, V5_SCHEMA_VERSION } from '@/v5/types'

const nonEmptyString = z.string().min(1)
const nullableString = z.string().nullable()
const stringArray = z.array(z.string())
const confidenceSchema = z.enum(['high', 'medium', 'low'])
const spanSchema = z.object({
  start: z.number().int().nonnegative().describe('相对 block.text 的 UTF-16 索引，包含该位置；完整 block 必须为 0'),
  end: z.number().int().positive().describe('半开区间的排他末端，必须等于 start + verbatimText.length；完整 block 必须为 block.text.length'),
}).strict().describe('JavaScript 半开区间 [start, end)，必须满足 block.text.slice(start, end) 与 verbatimText 逐字相等')
const evidenceStatusSchema = z.enum(['source_supported', 'source_qualified', 'excluded'])
const attributionLevelSchema = z.enum(['owned', 'drove', 'contributed', 'supported', 'unspecified'])
const scopeKindSchema = z.enum(['experience', 'internship', 'project', 'education', 'research', 'volunteer', 'other'])
const claimTypeSchema = z.enum([
  'identity',
  'timeline',
  'responsibility',
  'action',
  'deliverable',
  'result',
  'skill',
  'education',
  'certification',
  'language',
  'award',
  'publication',
  'patent',
  'portfolio_link',
  'other',
])
const riskFlagSchema = z.enum([
  'uncertain',
  'conflicting',
  'future_or_planned',
  'team_attribution',
  'self_assessment_only',
  'sensitive_pii',
  'prompt_injection_like_text',
])

export const numericAtomSchema = z.object({
  raw: nonEmptyString.describe('verbatimText 中逐字连续的原文数字短语，不得补写原文没有的单位或词语'),
  valueText: nonEmptyString.describe('raw 内逐字存在的数值文本，不做格式改写'),
  unit: nullableString.describe('仅填写 raw 内逐字存在的单位，否则为 null'),
  qualifier: nullableString.describe('仅填写 raw 内逐字存在的约、超过、至少等原文限定词；不得填写开始时间、结束时间、功能数量等解释性标签，否则为 null'),
  period: nullableString.describe('仅填写原文逐字存在的周期文本，否则为 null'),
  ownerScope: nullableString.describe('数字所属的 sourceScopeLocalId；无法安全归属时为 null'),
}).strict()

export const sourceBlockSchema = z.object({
  sourceBlockId: nonEmptyString,
  canonicalStart: z.number().int().nonnegative(),
  canonicalEnd: z.number().int().nonnegative(),
  text: z.string(),
  sectionHint: nullableString,
  inputRiskFlags: stringArray,
}).strict()

export const canonicalSourceDocumentSchema = z.object({
  documentId: nonEmptyString,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  primaryLanguage: nonEmptyString,
  canonicalLength: z.number().int().nonnegative(),
  blocks: z.array(sourceBlockSchema),
}).strict()

export const evidenceAtomSchema = z.object({
  evidenceId: nonEmptyString,
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceBlockId: nonEmptyString,
  sourceScopeId: nonEmptyString,
  sourceSpan: spanSchema,
  verbatimText: nonEmptyString,
  normalizedClaim: nonEmptyString,
  claimType: claimTypeSchema,
  status: evidenceStatusSchema,
  attributionLevel: attributionLevelSchema,
  sourceActionVerb: nullableString,
  qualifiers: stringArray,
  numericAtoms: z.array(numericAtomSchema),
  riskFlags: z.array(riskFlagSchema),
}).strict()

const resumeSectionTypeSchema = z.enum([
  'summary',
  'experience',
  'project',
  'education',
  'skills',
  'certifications',
  'languages',
  'awards',
  'publications',
  'patents',
  'research',
  'volunteer',
  'training',
  'portfolio',
  'custom',
])

const unmappedFragmentSchema = z.object({
  sourceBlockId: nonEmptyString,
  text: z.string(),
  reason: nonEmptyString,
  importance: z.enum(['low', 'medium', 'high']),
}).strict()

const qualityAssessmentSchema = z.object({
  scoreInputs: z.object({
    identityCompleteness: z.number().min(0).max(100),
    timelineCompleteness: z.number().min(0).max(100),
    evidenceResultDensity: z.number().min(0).max(100),
    clarity: z.number().min(0).max(100),
    sectionCoverage: z.number().min(0).max(100),
  }).strict(),
  strengths: z.array(z.object({
    statement: nonEmptyString,
    factLocalIds: stringArray,
    sourceBlockIds: stringArray,
  }).strict()).max(5),
  weaknesses: z.array(z.object({
    statement: nonEmptyString,
    factLocalIds: stringArray,
    sourceBlockIds: stringArray,
  }).strict()).max(5),
  suggestions: z.array(z.object({ statement: nonEmptyString, sourceBlockIds: stringArray }).strict()).max(5),
  capabilitySummary: z.string(),
}).strict()

export const resumeExtractionCandidateSchema = z.object({
  schemaVersion: z.literal(V5_SCHEMA_VERSION),
  identityCandidates: z.array(z.object({
    field: z.enum(['name', 'email', 'phone', 'city_level_location', 'link']),
    value: nonEmptyString,
    factLocalIds: z.array(nonEmptyString).min(1),
  }).strict()),
  timelineCandidates: z.array(z.object({
    scopeLocalId: nonEmptyString,
    kind: scopeKindSchema,
    organization: nullableString,
    title: nullableString,
    start: nullableString,
    end: nullableString,
    factLocalIds: stringArray,
  }).strict()),
  sectionCandidates: z.array(z.object({
    sectionLocalId: nonEmptyString,
    type: resumeSectionTypeSchema,
    title: z.string(),
    scopeLocalIds: stringArray,
    factLocalIds: stringArray,
  }).strict()),
  factCandidates: z.array(z.object({
    factLocalId: nonEmptyString,
    sourceBlockId: nonEmptyString,
    blockRelativeSpan: spanSchema,
    verbatimText: nonEmptyString,
    normalizedClaim: nonEmptyString,
    claimType: claimTypeSchema,
    sourceScopeLocalId: nonEmptyString.describe('必填且绝不能为 null；时间线事实使用对应 timeline.scopeLocalId，身份事实使用 identity，技能等非时间线章节使用稳定的非空本地 ID（如 skills）'),
    proposedStatus: evidenceStatusSchema,
    attributionLevel: attributionLevelSchema,
    sourceActionVerb: nullableString,
    qualifiers: stringArray,
    numericAtoms: z.array(numericAtomSchema),
    riskFlags: z.array(riskFlagSchema),
  }).strict()),
  unmappedFragments: z.array(unmappedFragmentSchema),
  conflicts: z.array(z.object({
    conflictLocalId: nonEmptyString,
    factLocalIds: z.array(nonEmptyString).min(1),
    description: nonEmptyString,
    proposedResolution: z.enum(['exclude_conflicting_claim', 'retain_with_qualifier', 'needs_user_confirmation']),
  }).strict()),
  coverageClaim: z.object({
    mappedSourceBlockIds: stringArray,
    unmappedSourceBlockIds: stringArray,
  }).strict(),
  qualityAssessment: qualityAssessmentSchema,
}).strict()

export function resumeExtractionCandidateSchemaWithFactLimit(maxFactCandidates: number) {
  if (!Number.isSafeInteger(maxFactCandidates) || maxFactCandidates < 1) {
    throw new RangeError('maxFactCandidates must be a positive safe integer')
  }
  return resumeExtractionCandidateSchema.extend({
    factCandidates: resumeExtractionCandidateSchema.shape.factCandidates.max(maxFactCandidates),
  }).strict()
}

export const resumeEvidenceBundleSchema = z.object({
  schemaVersion: z.literal(V5_SCHEMA_VERSION),
  sourceDocument: z.object({
    documentId: nonEmptyString,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    primaryLanguage: nonEmptyString,
  }).strict(),
  identity: z.object({
    name: z.object({ value: nullableString, evidenceIds: stringArray }).strict(),
    email: z.object({ value: nullableString, evidenceIds: stringArray }).strict(),
    phone: z.object({ value: nullableString, evidenceIds: stringArray }).strict(),
    cityLevelLocation: z.object({ value: nullableString, evidenceIds: stringArray }).strict(),
    links: z.array(z.object({ label: z.string(), url: nonEmptyString, evidenceIds: stringArray }).strict()),
  }).strict(),
  timeline: z.array(z.object({
    scopeId: nonEmptyString,
    kind: scopeKindSchema,
    organization: nullableString,
    title: nullableString,
    start: nullableString,
    end: nullableString,
    evidenceIds: stringArray,
  }).strict()),
  sections: z.array(z.object({
    sectionId: nonEmptyString,
    type: resumeSectionTypeSchema,
    title: z.string(),
    scopeIds: stringArray,
    evidenceIds: stringArray,
  }).strict()),
  evidenceAtoms: z.array(evidenceAtomSchema),
  unmappedFragments: z.array(unmappedFragmentSchema),
  conflicts: z.array(z.object({
    conflictId: nonEmptyString,
    evidenceIds: stringArray,
    description: nonEmptyString,
    resolution: z.enum(['exclude_conflicting_claim', 'retain_with_qualifier', 'needs_user_confirmation']),
  }).strict()),
  extractionCoverage: z.object({
    sourceBlockCount: z.number().int().nonnegative(),
    mappedBlockCount: z.number().int().nonnegative(),
    unmappedBlockCount: z.number().int().nonnegative(),
    coverageRatio: z.number().min(0).max(1),
    highImportanceUnmappedCount: z.number().int().nonnegative(),
    warnings: stringArray,
  }).strict(),
  qualityAssessment: qualityAssessmentSchema.extend({ score: z.number().min(0).max(100) }).strict(),
}).strict()

const requirementCategorySchema = z.enum([
  'education',
  'experience',
  'skill',
  'responsibility',
  'outcome',
  'language',
  'certification',
  'location',
  'schedule',
  'other',
])
const requirementImportanceSchema = z.enum(['must_have', 'core_outcome', 'differentiator', 'nice_to_have'])
const logicOperatorSchema = z.enum(['and', 'or', 'one_of']).nullable()

export const requirementAtomSchema = z.object({
  requirementId: nonEmptyString,
  sourceBlockId: nonEmptyString,
  sourceSpan: spanSchema,
  verbatimText: nonEmptyString,
  normalizedRequirement: nonEmptyString,
  category: requirementCategorySchema,
  importance: requirementImportanceSchema,
  logicGroupId: nullableString,
  logicOperator: logicOperatorSchema,
  explicitness: z.enum(['explicit', 'semantic_summary']),
}).strict()

const sourcedContextSchema = z.object({
  contextId: nonEmptyString,
  claim: nonEmptyString,
  sourceUrl: nonEmptyString,
  sourceTitle: nonEmptyString,
  publishedOrRetrievedAt: nonEmptyString,
  confidence: confidenceSchema,
}).strict()

export const jobExtractionCandidateSchema = z.object({
  schemaVersion: z.literal(V5_SCHEMA_VERSION),
  basicInfo: z.object({ title: nullableString, company: nullableString, location: nullableString }).strict(),
  basicInfoSourceBlockIds: stringArray,
  requirementCandidates: z.array(z.object({
    requirementLocalId: nonEmptyString,
    sourceBlockId: nonEmptyString,
    blockRelativeSpan: spanSchema,
    verbatimText: nonEmptyString,
    normalizedRequirement: nonEmptyString,
    category: requirementCategorySchema,
    importance: requirementImportanceSchema,
    logicGroupLocalId: nullableString,
    logicOperator: logicOperatorSchema,
    explicitness: z.enum(['explicit', 'semantic_summary']),
  }).strict()),
  explicitCompanySignals: z.array(z.object({ statement: nonEmptyString, requirementLocalIds: stringArray }).strict()),
  explicitLocationSignals: z.array(z.object({ statement: nonEmptyString, requirementLocalIds: stringArray }).strict()),
  uncertainties: z.array(z.object({ statement: nonEmptyString, sourceBlockIds: stringArray }).strict()),
  sourcedContextCandidates: z.array(sourcedContextSchema),
  unmappedFragments: z.array(unmappedFragmentSchema),
  coverageClaim: z.object({
    mappedSourceBlockIds: stringArray,
    unmappedSourceBlockIds: stringArray,
  }).strict(),
}).strict()

export const jobRequirementBundleSchema = z.object({
  schemaVersion: z.literal(V5_SCHEMA_VERSION),
  basicInfo: z.object({ title: nullableString, company: nullableString, location: nullableString }).strict(),
  requirementAtoms: z.array(requirementAtomSchema),
  explicitCompanySignals: stringArray,
  explicitLocationSignals: stringArray,
  uncertainties: stringArray,
  sourcedContext: z.array(sourcedContextSchema),
  extractionCoverage: z.object({
    sourceBlockCount: z.number().int().nonnegative(),
    mappedBlockCount: z.number().int().nonnegative(),
    unmappedBlockCount: z.number().int().nonnegative(),
    coverageRatio: z.number().min(0).max(1),
    highImportanceUnmappedCount: z.number().int().nonnegative(),
  }).strict(),
}).strict()

const requirementMatchStatusSchema = z.enum([
  'direct_match',
  'transferable_match',
  'currently_unproven',
  'not_applicable',
  'conflicting_evidence',
])

export const v5MatchAnalysisSchema = z.object({
  schemaVersion: z.literal(V5_SCHEMA_VERSION),
  requirementMatches: z.array(z.object({
    requirementId: nonEmptyString,
    status: requirementMatchStatusSchema,
    evidenceIds: stringArray,
    confidence: confidenceSchema,
    rationale: nonEmptyString,
  }).strict()),
  strengths: z.array(z.object({
    strengthId: nonEmptyString,
    requirementIds: stringArray,
    evidenceIds: z.array(nonEmptyString).min(1),
    statement: nonEmptyString,
  }).strict()).max(5),
  gaps: z.array(z.object({
    gapId: nonEmptyString,
    requirementIds: z.array(nonEmptyString).min(1),
    evidenceType: z.enum(['direct_missing', 'implicit_evidence', 'wording_gap']),
    priority: z.enum(['high', 'medium', 'low']),
    evidenceIds: stringArray,
    impact: nonEmptyString,
    safeHandling: nonEmptyString,
  }).strict()).max(4),
  positioning: z.object({
    statement: z.string(),
    primaryRequirementIds: stringArray,
    primaryEvidenceIds: stringArray,
    forbiddenIdentityClaims: stringArray,
  }).strict(),
  scoreInputs: z.object({
    mustHaveApplicable: z.number().int().nonnegative(),
    mustHaveDirect: z.number().int().nonnegative(),
    mustHaveTransferable: z.number().int().nonnegative(),
    coreOutcomeApplicable: z.number().int().nonnegative(),
    coreOutcomeDirect: z.number().int().nonnegative(),
    coreOutcomeTransferable: z.number().int().nonnegative(),
    evidenceClarityRatio: z.number().min(0).max(1),
  }).strict(),
  contextUsed: z.array(z.object({ contextId: nonEmptyString, effect: nonEmptyString }).strict()),
}).strict()

export const strategyProfileSchema = z.object({
  profileVersion: z.literal(V5_ADAPTIVE_POLICY_VERSION),
  careerStage: z.enum(['student_or_early', 'experienced', 'senior_or_leadership', 'mixed', 'unknown']),
  evidenceShape: z.enum(['experience_led', 'project_led', 'research_led', 'portfolio_led', 'mixed']),
  evidenceRichness: z.enum(['sparse', 'standard', 'rich']),
  targetDistance: z.enum(['direct', 'adjacent', 'transition']),
  outputLanguage: nonEmptyString,
  confidence: confidenceSchema,
  reasons: z.array(z.object({ signal: nonEmptyString, evidenceIds: stringArray, requirementIds: stringArray }).strict()),
  metrics: z.object({
    eligibleBusinessEvidenceCount: z.number().int().nonnegative(),
    resultEvidenceCount: z.number().int().nonnegative(),
    experienceScopeCount: z.number().int().nonnegative(),
    projectScopeCount: z.number().int().nonnegative(),
    researchScopeCount: z.number().int().nonnegative(),
    portfolioEvidenceCount: z.number().int().nonnegative(),
    highImportanceUnmappedCount: z.number().int().nonnegative(),
  }).strict(),
}).strict()

export const generationPolicySchema = z.object({
  policyVersion: z.literal(V5_ADAPTIVE_POLICY_VERSION),
  mode: z.enum(['preserve_sparse', 'balanced_targeted', 'selective_rich']),
  sectionOrder: z.array(nonEmptyString).min(1),
  summaryPolicy: z.enum(['omit_if_unsupported', 'one_sentence', 'one_to_two_sentences', 'one_to_three_sentences']),
  targetBusinessBulletMin: z.number().int().nonnegative(),
  targetBusinessBulletMax: z.number().int().nonnegative(),
  hardTotalListItemMax: z.number().int().positive(),
  hardProjectMax: z.number().int().nonnegative(),
  stableCoreCoverageMin: z.number().min(0).max(1),
  primaryRequirementCoverageMin: z.number().min(0).max(1),
  preferredDirectEvidenceRatio: z.object({ min: z.number().min(0).max(1), max: z.number().min(0).max(1) }).strict(),
  outputLength: z.object({
    unit: z.enum(['cjk_characters', 'words']),
    softMin: z.number().int().nonnegative().nullable(),
    softMax: z.number().int().positive(),
    hardMax: z.number().int().positive(),
  }).strict(),
  fallbackPolicy: z.enum(['balanced_default', 'source_preserving']),
}).strict()

export const strategyResolutionSchema = z.object({
  schemaVersion: z.literal(V5_SCHEMA_VERSION),
  selectedProfileId: nonEmptyString,
  selectedPolicyId: nonEmptyString,
  confidence: confidenceSchema,
  basis: z.array(z.object({ statement: nonEmptyString, evidenceIds: stringArray, requirementIds: stringArray }).strict()),
}).strict()

export const v5ResumePlanSchema = z.object({
  schemaVersion: z.literal(V5_SCHEMA_VERSION),
  strategyProfile: strategyProfileSchema,
  generationPolicy: generationPolicySchema,
  targetValueProposition: z.string(),
  primaryRequirementIds: z.array(nonEmptyString).max(3),
  stableCoreEvidenceIds: stringArray.describe('稳定核心内容证据；不得包含 identity/timeline，业务证据还必须进入同 scope 的 scopePlan，skill 必须 featured'),
  customizedEvidenceIds: stringArray.describe('针对当前 JD 的内容证据；不得包含 identity/timeline，业务证据还必须进入同 scope 的 scopePlan，skill 必须 featured'),
  evidencePillars: z.array(z.object({
    pillarId: nonEmptyString,
    title: nonEmptyString,
    requirementIds: stringArray,
    evidenceIds: z.array(nonEmptyString).min(1),
    role: z.enum(['career_anchor', 'jd_primary', 'jd_adjacent']),
  }).strict()).max(4),
  scopePlans: z.array(z.object({
    scopeId: nonEmptyString,
    scopeType: scopeKindSchema,
    treatment: z.enum(['expand', 'compress', 'timeline_line', 'include', 'omit']).describe('工作/实习：至少2条已选证据才能 expand，1条必须 compress，0条必须 timeline_line；项目/研究：至少1条才能 include，否则 omit'),
    selectedEvidenceIds: stringArray.describe('仅限与 scopeId 相同的合法业务证据；identity、timeline 和 skill 不得放入'),
    bulletBudget: z.number().int().nonnegative().describe('expand 为 2..已选证据数；compress 为1；timeline_line/omit 为0；include 为1..已选证据数'),
    rewriteAngle: z.string(),
  }).strict()).describe('若完整合法业务证据数量足够，所有业务 scope 的 bulletBudget 总和必须达到 generationPolicy.targetBusinessBulletMin'),
  featuredSkillEvidenceIds: stringArray.describe('仅放 claimType=skill 的合法证据；所有被上层列表选中的 skill 都必须在此分配'),
  safeKeywordMappings: z.array(z.object({
    requirementId: nonEmptyString,
    evidenceIds: z.array(nonEmptyString).min(1),
    safePhrase: nonEmptyString,
  }).strict()),
  forbiddenRequirementIds: stringArray,
  omittedHighValueEvidence: z.array(z.object({ evidenceId: nonEmptyString, reason: nonEmptyString }).strict()),
  lowerBoundException: nullableString.describe('模型必须返回 null；服务端仅在完整证据客观不足时确定性填充例外说明'),
}).strict()

const claimSchema = z.object({
  claimId: nonEmptyString,
  outputPath: nonEmptyString.describe('稳定逻辑路径；identity.* 仅用于身份，timeline.* 仅用于时间线，其余正文使用章节.scope.bullets[index]'),
  outputText: nonEmptyString.describe('必须逐字等于 Markdown 中唯一一整行，包含该行原有的 - 列表标记，不得只写去掉列表标记后的正文'),
  evidenceIds: z.array(nonEmptyString).min(1),
  transformation: z.enum(['verbatim', 'compress', 'reorder', 'safe_paraphrase', 'same_scope_merge']).describe('verbatim 仅用于单一证据逐字呈现（允许 Markdown 标题/列表符与“技能：”展示标签差异）；摘要跨 scope 综合使用 compress 或 safe_paraphrase；same_scope_merge 必须至少两条且同 scope'),
  attributionLevel: attributionLevelSchema,
}).strict()

const renderStatsSchema = z.object({
  businessBulletCount: z.number().int().nonnegative(),
  totalListItemCount: z.number().int().nonnegative(),
  projectCount: z.number().int().nonnegative(),
  cjkCharacterCount: z.number().int().nonnegative(),
  wordCount: z.number().int().nonnegative(),
}).strict().describe('由服务端按 markdown 确定性重算；模型只需提供满足类型的暂存值，不能据此改变内容')

export const generatedResumeArtifactSchema = z.object({
  schemaVersion: z.literal(V5_SCHEMA_VERSION),
  markdown: nonEmptyString,
  claims: z.array(claimSchema),
  usedEvidenceIds: stringArray,
  omittedPlannedEvidenceIds: stringArray,
  renderStats: renderStatsSchema,
}).strict()

export const validationIssueSchema = z.object({
  issueId: nonEmptyString,
  severity: z.enum(['error', 'warning', 'info']),
  code: nonEmptyString,
  outputPath: nullableString,
  claimId: nullableString,
  evidenceIds: stringArray,
  requirementIds: stringArray,
  message: nonEmptyString,
  expectedConstraint: nonEmptyString,
  replacementText: nullableString,
}).strict()

const blockingFactJudgeIssueSchema = z.object({
  issueId: nonEmptyString,
  severity: z.enum(['error', 'warning', 'info']),
  code: z.enum([
    'unsupported_claim',
    'number_or_qualifier_change',
    'attribution_upgrade',
    'scope_migration',
    'stage_upgrade',
    'causality_invented',
    'jd_or_context_leak',
    'claim_mapping_insufficient',
    'writing_quality_only',
  ]),
  claimId: nonEmptyString,
  evidenceIds: stringArray,
  message: z.string().min(1).max(400),
  safeRepairDirection: z.string().min(1).max(300),
}).strict()

export function blockingFactJudgeResultSchemaWithIssueLimit(maxIssues: number) {
  return z.object({
    schemaVersion: z.literal(V5_SCHEMA_VERSION),
    passed: z.boolean(),
    auditedClaimCount: z.number().int().nonnegative(),
    issues: z.array(blockingFactJudgeIssueSchema).max(Math.max(0, Math.floor(maxIssues))),
  }).strict()
}

export const blockingFactJudgeResultSchema = blockingFactJudgeResultSchemaWithIssueLimit(64)

export const interviewPreparationSchema = z.object({
  schemaVersion: z.literal(V5_SCHEMA_VERSION),
  questions: z.array(z.object({
    question: nonEmptyString,
    category: z.enum(['core_task', 'project_deep_dive', 'gap_or_transfer', 'context_scenario']),
    relatedRequirementIds: stringArray,
    relatedEvidenceIds: stringArray,
    preparationFocus: nonEmptyString,
    assumptionContextIds: stringArray,
  }).strict()).length(4),
  storyRecommendations: z.array(z.object({
    title: nonEmptyString,
    scopeId: nonEmptyString,
    evidenceIds: z.array(nonEmptyString).min(1),
    background: nonEmptyString,
    knownResult: nullableString,
    preparationGap: nullableString,
  }).strict()).min(1).max(2),
  followUpQuestions: z.array(z.object({
    question: nonEmptyString,
    purpose: nonEmptyString,
    relatedRequirementIds: stringArray,
    assumptionContextIds: stringArray,
  }).strict()).length(3),
}).strict()

export const resumeQualityJudgeResultSchema = z.object({
  schemaVersion: z.literal(V5_SCHEMA_VERSION),
  evaluatorId: nonEmptyString,
  dimensions: z.array(z.object({
    name: z.enum([
      'job_specificity',
      'evidence_selection',
      'career_coherence',
      'result_expression',
      'conciseness_readability',
      'deliverability',
    ]),
    score: z.number().nonnegative(),
    maxScore: z.number().positive(),
    evidence: stringArray,
    issues: stringArray,
  }).strict()).length(6),
  deliverabilityGate: z.enum(['pass', 'fail']),
  factualIncidentCandidates: z.array(z.object({
    severity: z.enum(['error', 'warning']),
    claimId: nullableString,
    message: nonEmptyString,
  }).strict()),
}).strict().superRefine((result, context) => {
  const seenDimensions = new Set<string>()
  result.dimensions.forEach((dimension, index) => {
    if (seenDimensions.has(dimension.name)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dimensions', index, 'name'],
        message: `质量维度 ${dimension.name} 重复，六个维度必须各出现一次`,
      })
    }
    seenDimensions.add(dimension.name)

    if (dimension.score > dimension.maxScore) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dimensions', index, 'score'],
        message: `${dimension.name}.score 不得超过其 maxScore ${dimension.maxScore}`,
      })
    }
  })
})

const abDimensionsSchema = z.object({
  factualFidelity: z.number().min(0).max(25),
  jobSpecificity: z.number().min(0).max(20),
  evidenceSelection: z.number().min(0).max(15),
  highValueEvidenceRecall: z.number().min(0).max(10),
  careerCoherence: z.number().min(0).max(10),
  concisenessReadability: z.number().min(0).max(10),
  deliverability: z.number().min(0).max(10),
}).strict()

const blindABCandidateEvaluationSchema = z.object({
  candidateId: z.enum(['A', 'B']),
  absoluteGate: z.enum(['pass', 'fail']),
  dimensions: abDimensionsSchema,
  unsupportedClaims: stringArray,
  attributionErrors: stringArray,
  emptyScopes: stringArray,
  missingHighValueEvidence: stringArray,
  internalAuditLeaks: stringArray,
  strengths: stringArray,
  weaknesses: stringArray,
}).strict().superRefine((evaluation, context) => {
  if (evaluation.absoluteGate !== 'pass') return

  const hardGateCollections = [
    ['unsupportedClaims', evaluation.unsupportedClaims],
    ['attributionErrors', evaluation.attributionErrors],
    ['emptyScopes', evaluation.emptyScopes],
    ['internalAuditLeaks', evaluation.internalAuditLeaks],
  ] as const
  for (const [field, issues] of hardGateCollections) {
    if (issues.length === 0) continue
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [field],
      message: `absoluteGate=pass 时 ${field} 必须为空`,
    })
  }
})

function blindABTotal(evaluation: z.infer<typeof blindABCandidateEvaluationSchema>) {
  return Object.values(evaluation.dimensions).reduce((sum, score) => sum + score, 0)
}

export const blindABEvaluationSchema = z.object({
  schemaVersion: z.literal(V5_SCHEMA_VERSION),
  evaluations: z.array(blindABCandidateEvaluationSchema).length(2),
  pairwise: z.object({
    winner: z.enum(['A', 'B', 'tie']),
    confidence: confidenceSchema,
    reason: nonEmptyString,
  }).strict(),
}).strict().superRefine((result, context) => {
  const evaluationsById = new Map(result.evaluations.map(evaluation => [evaluation.candidateId, evaluation]))
  if (evaluationsById.size !== 2 || !evaluationsById.has('A') || !evaluationsById.has('B')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['evaluations'],
      message: 'evaluations 必须恰好包含一个 candidateId=A 和一个 candidateId=B',
    })
    return
  }

  const candidateA = evaluationsById.get('A')!
  const candidateB = evaluationsById.get('B')!
  let expectedWinner: 'A' | 'B' | 'tie'
  if (candidateA.absoluteGate !== candidateB.absoluteGate) {
    expectedWinner = candidateA.absoluteGate === 'pass' ? 'A' : 'B'
  } else {
    const totalA = blindABTotal(candidateA)
    const totalB = blindABTotal(candidateB)
    expectedWinner = totalA === totalB ? 'tie' : totalA > totalB ? 'A' : 'B'
  }

  if (result.pairwise.winner !== expectedWinner) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pairwise', 'winner'],
      message: `pairwise.winner 与服务端门禁及维度总分不一致，应为 ${expectedWinner}`,
    })
  }
})

export type ResumeExtractionCandidateOutput = z.infer<typeof resumeExtractionCandidateSchema>
export type JobExtractionCandidateOutput = z.infer<typeof jobExtractionCandidateSchema>
export type V5MatchAnalysisOutput = z.infer<typeof v5MatchAnalysisSchema>
export type V5ResumePlanOutput = z.infer<typeof v5ResumePlanSchema>
export type GeneratedResumeArtifactOutput = z.infer<typeof generatedResumeArtifactSchema>
