import {createCanonicalDigest} from '@/harness/run-context'
import {env} from '@/config/env'
import {V5_PROMPT_VERSIONS} from '@/v5/prompts'
import {RESUME_EXTRACTION_CHUNK_PLAN_VERSION} from '@/v5/chunked-resume-extraction'
import {ENTRY_WRITING_POLICY, SKELETON_POLICY_VERSION} from '@/v5/writing/entries'
import manifest from '@/v5/prompts/manifest.json'

export type ResumeCachedStage = 'extraction' | 'matching' | 'generation' | 'interview'
export function resumeStageFingerprint(stage: ResumeCachedStage, versions: Record<string, string> = V5_PROMPT_VERSIONS) {
  const provider = {model: env.AI_MODEL,endpoint: env.OPENAI_BASE_URL,structuredOutput: env.V5_STRUCTURED_OUTPUT_MODE,
    thinking: stage === 'extraction' ? env.DEEPSEEK_P01_THINKING_MODE : env.DEEPSEEK_THINKING_MODE,
    contextWindowTokens:env.V5_CONTEXT_WINDOW_TOKENS}
  const components = stage === 'extraction' ? ['P01','P01R'] : stage === 'matching' ? ['P02','P02R','P03','P03R']
    : stage === 'interview' ? ['P10','P10R'] : ['P04','P05','P05R','P06C','P07','P08','P09']
  return createCanonicalDigest({stage,contract: `resume-${stage}-artifact-v1`,provider,
    prompts: Object.fromEntries(components.map(id => [id, versions[id] ?? null])),
    ...(stage === 'matching' ? {variants: {P03: manifest.variants.P03_TARGETED,P03R: manifest.variants.P03R_TARGETED}} : {}),
    ...(stage === 'generation' ? {variant: manifest.variants.P06C_ENTRY} : {}),
    ...(stage === 'extraction' ? {chunkPlan: RESUME_EXTRACTION_CHUNK_PLAN_VERSION,structure: 'source-structure-v2',sourceIdentity: 'explicit-source-project-parent-v2'} : {}),
    ...(stage === 'matching' ? {targeting: 'job-targeted-v2',requirementScope:'field-assertion-specialty-ownership-v9',projection:'condition-semantics-partial-narrative-recovery-v6',judgment: 'requirement-judgment-v2',score: 'match-score-v3',action: 'resume-action-plan-v1',transportBudget:'schema-scoped-deadline-preflight-v3'} : {}),
    ...(stage === 'interview' ? {resultEvidence: 'literal-completed-clause-quantity-tail-v3',preparationTopics:'unique-actionable-case-topics-v2',presentation:'interview-presentation-v1',requirementLinks:'explicit-story-evidence-v1',revisionFacts:'user-fact-snapshot-v1'} : {}),
    ...(stage === 'generation' ? {writer: ENTRY_WRITING_POLICY,skeleton: SKELETON_POLICY_VERSION,document: 'resume-completion-v4',compiler: 'completion-compiler-v4-r3',informationRouting:'assertion-routing-v1',hintPolicy:'single-sentence-v1',skillDimensionsPolicy:'fixed-source-complete-dimension-v1',skillCasePolicy:'same-source-evidence-projection-v3',receiptPolicy:'strict-transport-receipt-quarantine-v3',coveragePolicy:'server-owned-ancillary-v1',numericPolicy:'explicit-version-connector-v2',layoutPolicy:'entry-scoped-bounded-reflow-v3',actionBinding:'scoped-multi-unit-v4',details: 'meaning-critical-consistency-v7',recovery: 'unit-local-final-cause-v6',selection:'source-facets-v2',structureManifest: 'resume-structure-basis-v1',delivery: 'six-gates-v1'} : {})})
}
export function resumeStageCacheKey(stage: ResumeCachedStage, owner: string, dependency: unknown) {
  return createCanonicalDigest({version: 'resume-stage-cache-v1',stage,owner,fingerprint: resumeStageFingerprint(stage),dependency})
}
