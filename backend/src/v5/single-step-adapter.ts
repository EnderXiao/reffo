import type { StepRunSnapshot } from '@/harness/run-step'
import { createDigest } from '@/harness/run-context'
import { env } from '@/config/env'
import { v5ReleaseWorkflowOptions } from '@/config/v5-release'
import { V5CheckpointError, V5CheckpointRepository } from '@/repositories/v5-checkpoint-repository'
import { V5ResumeOptimizationWorkflow, type V5MatchingCheckpoint } from '@/v5/main/workflow'
import { toResumeAnalysis, toMatchAnalysis, toLegacyMvpProcessResponse, toInterviewPreparation } from '@/v5/main/compatibility'
import { V5_WORKFLOW_VERSION, type V5ResumeExtractionResult, type V5WorkflowResult } from '@/v5/types'
import type { ResumeAnalysis, InterviewSuggestions } from '@/types'
import manifest from '@/v5/prompts/manifest.json'

// 版本读取真实 Prompt manifest；变更模型、思考模式或 Prompt 后旧检查点不能混用。
export function singleStepFingerprint() {
  return createDigest({workflow: V5_WORKFLOW_VERSION, manifest, protocol: 'v5-single-step-v1',
    model: env.AI_MODEL, endpoint: env.OPENAI_BASE_URL, thinking: env.DEEPSEEK_THINKING_MODE,
    extractionThinking: env.DEEPSEEK_P01_THINKING_MODE, structuredOutput: env.V5_STRUCTURED_OUTPUT_MODE})
}

interface ResumeCheckpoint {
  kind: 'resume'
  source: string
  extraction: V5ResumeExtractionResult
  analysis: ResumeAnalysis
  resumeDigest: string
}
interface MatchingCheckpoint {
  kind: 'matching'
  resumeToken: string
  checkpoint: V5MatchingCheckpoint
  generated?: V5WorkflowResult
  interview?: {runId: string; data: InterviewSuggestions; steps: StepRunSnapshot[]}
}
type Checkpoint = ResumeCheckpoint | MatchingCheckpoint

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new V5CheckpointError()
  return value as Record<string, unknown>
}
function resumeDigest(value: unknown) {
  const {_v5_context: _token, ...resume} = record(value)
  return createDigest(resume)
}
function checkpoint(value: unknown): Checkpoint {
  const row = record(value)
  if (row.kind !== 'resume' && row.kind !== 'matching') throw new V5CheckpointError()
  // 只读取服务端写入的私有存储；HTTP 传入的是随机句柄而非证据对象。
  return row as unknown as Checkpoint
}

type StageWorkflow = Pick<V5ResumeOptimizationWorkflow, 'extractResume' | 'matchResume' | 'generateResume' | 'prepareInterview'>

export class V5SingleStepAdapter {
  constructor(
    private readonly repository = new V5CheckpointRepository(singleStepFingerprint()),
    private readonly workflow: () => StageWorkflow = () => new V5ResumeOptimizationWorkflow(v5ReleaseWorkflowOptions()),
  ) {}

  async analyze(source: string, owner: string) {
    const extraction = await this.workflow().extractResume({resumeMarkdown: source, workflowTimeoutMs: 120000})
    const analysis = toResumeAnalysis(extraction)
    const token = await this.repository.save(owner, {kind: 'resume', source, extraction, analysis,
      resumeDigest: resumeDigest(analysis.structured_resume)} satisfies ResumeCheckpoint)
    return {runId: extraction.runId, steps: extraction.stepStatuses ?? [], data: {...analysis, structured_resume: {...analysis.structured_resume, _v5_context: token}}}
  }

  private async resume(structured: unknown, owner: string) {
    const token = record(structured)._v5_context
    const stored = checkpoint((await this.repository.load(token, owner)).payload)
    if (stored.kind !== 'resume' || stored.resumeDigest !== resumeDigest(structured)) throw new V5CheckpointError()
    return {stored, token: token as string}
  }

  async match(structured: unknown, jd: string, owner: string) {
    const {stored, token: resumeToken} = await this.resume(structured, owner)
    const result = await this.workflow().matchResume({resumeMarkdown: stored.source, jobDescription: jd, workflowTimeoutMs: 60000}, stored.extraction)
    const token = await this.repository.save(owner, {kind: 'matching', resumeToken, checkpoint: result} satisfies MatchingCheckpoint)
    const matching = toMatchAnalysis({...result, resumeEvidenceBundle: stored.extraction.resumeEvidenceBundle})
    return {runId: result.runId, steps: result.stepStatuses ?? [], data: {...matching, jd_structure: {...matching.jd_structure, _v5_context: token}}}
  }

  private async matching(structured: unknown, matching: unknown, owner: string) {
    const {token: resumeToken} = await this.resume(structured, owner)
    const token = record(record(matching).jd_structure)._v5_context
    const row = await this.repository.load(token, owner)
    const stored = checkpoint(row.payload)
    if (stored.kind !== 'matching' || stored.resumeToken !== resumeToken) throw new V5CheckpointError()
    return {row, stored}
  }

  async generate(structured: unknown, matching: unknown, owner: string) {
    const {row, stored} = await this.matching(structured, matching, owner)
    const result = stored.generated ?? await this.workflow().generateResume(stored.checkpoint, {workflowTimeoutMs: 90000})
    const response = toLegacyMvpProcessResponse(result)
    if (!stored.generated) await this.repository.update(row, {...stored, generated: result})
    return {runId: result.runId, steps: result.stepStatuses ?? [], data: {optimized_resume: response.step3_optimized_resume,
      changes_summary: response.step2_matching.optimization_suggestions ?? [], improvement_score: 0}}
  }

  async interview(analysis: unknown, matching: unknown, optimized: string, owner: string) {
    const {row, stored} = await this.matching(record(analysis).structured_resume, matching, owner)
    if (!stored.generated || stored.generated.artifact.markdown.trim() !== optimized.trim()) throw new V5CheckpointError()
    if (stored.interview) return stored.interview
    const result = await this.workflow().prepareInterview(stored.generated)
    const interview = {runId: result.runId, steps: result.stepStatuses ?? [], data: toInterviewPreparation(result.preparation)}
    await this.repository.update(row, {...stored, interview})
    return interview
  }
}

export const v5SingleStepAdapter = new V5SingleStepAdapter()
