import { expect, test } from 'bun:test'
import type { LlmProvider } from '@/providers/llm-provider'
import { createResumeFixture, FIXTURE_RESUME, FIXTURE_JD } from '@/v5/tests/fixtures'
import { createTargetingFixture } from '@/v5/tests/targeting-fixtures'
import { V5ResumeOptimizationWorkflow } from '@/v5/main/workflow'
import { ENTRY_WRITING_POLICY, type entryWritingPayload } from '@/v5/writing/entries'
import type { EntryStreamEvent } from '@/v5/writing/entry-stream'
import type { JobTarget } from '@/v5/targeting/profile'
import { validateGeneratedResumeArtifact } from '@/v5/validators'
import { PRACTICE_SKILL_POLICY } from '@/v5/writing/skills'

type Payload = Partial<ReturnType<typeof entryWritingPayload>> & {
  targets: JobTarget[]
  resumeContext: { facts: Array<{ evidenceId: string; claimType: string }> }
}

test.each(['valid', 'truncated', 'foreign_reference', 'empty_body'] as const)('entry workflow %s uses the new prompt and one Writer without a repair loop', async variant => {
  const versions: string[] = [], events: EntryStreamEvent[] = []
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
        if (variant === 'foreign_reference') paragraphs[0].evidenceIds = ['foreign-project']
        return { entryId: entry.entryId, paragraphs }
      }) }
      let content = JSON.stringify(value)
      if (variant === 'truncated') content = content.slice(0, -3)
      if (variant === 'empty_body') content = ''
      for (let i = 0; i < content.length; i += 9) input.onContentDelta!(content.slice(i, i + 9))
      return { provider: 'fake', model: 'fixture', content, latencyMs: 1, physicalAttempts: 1,
        inputTokens: 30, outputTokens: 50, finishReason: variant === 'truncated' ? 'length' : 'stop' }
    } else throw new Error('UNEXPECTED_MODEL_STAGE')
    return { provider: 'fake', model: 'fixture', content: JSON.stringify(value), latencyMs: 1, physicalAttempts: 1 }
  } }
  const workflow = new V5ResumeOptimizationWorkflow({ provider, enableDefaultSubscribers: false,
    artifactGenerationMode: 'writer_v1', jobTargetingPolicy: 'job-targeted-v1', entryWritingPolicy: ENTRY_WRITING_POLICY,
    onEntryStreamEvent: event => { events.push(event) } })
  const promise = workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD })
  if (variant === 'valid') {
    const result = await promise
    expect(result.state).toBe('succeeded')
    expect(result.usedSafeFallback).toBe(false)
    expect(result.artifact.markdown).toContain('参与团队产品迭代。')
    expect(result.artifact.markdown).toContain('团队交付3个功能。')
    expect(result.artifact.markdown).not.toContain('entry:')
    expect(result.entryWriting?.version).toBe(ENTRY_WRITING_POLICY)
    const replay = validateGeneratedResumeArtifact({ artifact: result.artifact, resume: result.resumeEvidenceBundle,
      plan: result.entryWriting!.renderingPlan, policy: result.generationPolicy,
      gateMode: 'relaxed_release', textPolicy: 'supported_writing_v1', skillPolicy: PRACTICE_SKILL_POLICY,
      entryParagraphPaths: new Set(result.entryWriting!.paragraphPaths) })
    expect(replay.passed).toBe(true)
    expect(replay.value!.markdown).toBe(result.artifact.markdown)
    expect(events.some(event => event.type === 'entry.preview')).toBe(true)
    expect(events.at(-1)?.type).toBe('writer.completed')
  } else {
    await expect(promise).rejects.toThrow()
    expect(events.at(-1)?.type).toBe('writer.failed')
    expect(events.some(event => event.type === 'writer.completed')).toBe(false)
    if (variant === 'foreign_reference') expect(events.some(event => event.type === 'entry.preview')).toBe(false)
  }
  expect(versions).toHaveLength(4)
  expect(versions.filter(v => v.includes('-p06c-'))).toHaveLength(1)
  expect(versions.some(v => /-p0[589]-|-p12-|-p06d-/.test(v))).toBe(false)
})
