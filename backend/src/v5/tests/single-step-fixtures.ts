import { expect } from 'bun:test'
import type { LlmProvider } from '@/providers/llm-provider'
import { createResumeFixture, FIXTURE_RESUME, FIXTURE_JD } from '@/v5/tests/fixtures'
import { createTargetingFixture } from '@/v5/tests/targeting-fixtures'
import { V5ResumeOptimizationWorkflow } from '@/v5/main/workflow'
import { ENTRY_WRITING_POLICY, type entryWritingPayload } from '@/v5/writing/entries'
import type { JobTarget } from '@/v5/targeting/profile'

type Payload = Partial<ReturnType<typeof entryWritingPayload>> & {
  resumeEvidenceBundle?: import('@/v5/types').ResumeEvidenceBundle
  jobRequirementBundle?: import('@/v5/types').JobRequirementBundle
  targets: JobTarget[]
  resumeContext: { facts: Array<{ evidenceId: string; claimType: string }> }
}

export function createSingleStepFixture() {
  const versions: string[] = []
  const provider: LlmProvider = { complete: async input => {
    const version = input.promptVersion!
    versions.push(version)
    const source = input.messages.find(m => m.role === 'user')!.content.match(/UNTRUSTED_INPUT_JSON:\n([\s\S]+?)\n\n只返回本阶段/)![1]
    const payload: Payload = JSON.parse(source).payload
    let value: unknown
    if (version.includes('-p01-')) value = createResumeFixture().candidate
    else if (version.includes('-p02-')) value = createTargetingFixture().candidate
    else if (version.includes('-p03-')) {
      const fact = payload.resumeContext.facts.find(f => f.claimType === 'deliverable')!
      value = { contractVersion: 'job-fit-map-v1', links: payload.targets.map(target => ({
        targetId: target.id, status: 'transferable', evidenceIds: [fact.evidenceId],
        similarity: '具有相邻产品实践。', difference: '尚不等于完整岗位经验。', expressionAngle: '突出已有交付。',
      })), narratives: [], questions: [] }
    } else if (version === '5.2.0-p06c-entry-writer-r5') {
      expect(input.onContentDelta).toBeFunction()
      expect(input.maxOutputTokens).toBe(4320)
      expect(input.maxProviderAttempts).toBe(1)
      expect(input.maxProviderModels).toBe(1)
      expect(payload.entries).toBeDefined()
      value = { contractVersion: ENTRY_WRITING_POLICY, entries: payload.entries!.map(entry => {
        const fact = entry.facts.find(f => entry.coreEvidenceIds.includes(f.evidenceId)) ?? entry.facts[0]
        const paragraphs = entry.section === 'experience'
          ? [{ role: 'contribution', text: '参与团队产品迭代。', evidenceIds: [fact.evidenceId] },
            { role: 'outcome', text: '团队交付3个功能。', evidenceIds: [fact.evidenceId] }]
          : [{ role: 'detail', text: fact.text, evidenceIds: [fact.evidenceId] }]
        return { entryId: entry.entryId, paragraphs }
      }) }
      let content = JSON.stringify(value)
      for (let i = 0; i < content.length; i += 9) input.onContentDelta!(content.slice(i, i + 9))
      return { provider: 'fake', model: 'fixture', content, latencyMs: 1, physicalAttempts: 1,
        inputTokens: 30, outputTokens: 50, finishReason: 'stop' }
    } else if (version.includes('-p10-')) {
      const bundle = payload.resumeEvidenceBundle!
      const fact = bundle.evidenceAtoms.find(f => f.claimType === 'deliverable')!
      const requirement = payload.jobRequirementBundle!.requirementAtoms[0].requirementId
      value = {schemaVersion: '5.0.0',
        questions: ['core_task', 'project_deep_dive', 'gap_or_transfer', 'context_scenario'].map(category => ({
          question: '你如何参与产品迭代？', category, relatedRequirementIds: [requirement], relatedEvidenceIds: [fact.evidenceId],
          preparationFocus: '说明自己的贡献', assumptionContextIds: [],
        })), storyRecommendations: [{title: '产品迭代', scopeId: fact.sourceScopeId, evidenceIds: [fact.evidenceId],
          background: fact.verbatimText, knownResult: null, preparationGap: '准备真实反馈'}],
        followUpQuestions: [1, 2, 3].map(i => ({question: `岗位的第${i}项成功标准是什么？`, purpose: '了解职责',
          relatedRequirementIds: [requirement], assumptionContextIds: []})),
      }
    } else throw new Error('UNEXPECTED_MODEL_STAGE')
    return { provider: 'fake', model: 'fixture', content: JSON.stringify(value), latencyMs: 1, physicalAttempts: 1 }
  } }

  const createWorkflow = () => new V5ResumeOptimizationWorkflow({ provider, enableDefaultSubscribers: false,
    artifactGenerationMode: 'writer_v1', jobTargetingPolicy: 'job-targeted-v1', entryWritingPolicy: ENTRY_WRITING_POLICY })
  return {createWorkflow, versions}
}
