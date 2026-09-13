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
import { createHarnessEventBus } from '@/harness/event-bus'
import type { HarnessEvent } from '@/harness/events'

type Payload = Partial<ReturnType<typeof entryWritingPayload>> & {
  targets: JobTarget[]
  resumeContext: { facts: Array<{ evidenceId: string; claimType: string }> }
}

test.each(['valid', 'corrected_number', 'uncorrected_number', 'empty_note', 'nonempty_note', 'unknown_field', 'truncated', 'foreign_reference', 'empty_body', 'missing_entry', 'duplicate_entry', 'unknown_entry'] as const)('entry workflow %s validates output with bounded fact correction', async variant => {
  const versions: string[] = [], events: EntryStreamEvent[] = []
  const eventBus = createHarnessEventBus(), diagnostics: HarnessEvent[] = []
  const validations: HarnessEvent[] = []
  eventBus.subscribe('writing.validation.observed', event => { diagnostics.push(event) })
  eventBus.subscribe('output.validated', event => { validations.push(event) })
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
    } else if (version === '5.2.0-p06c-entry-writer-r8') {
      if (versions.filter(v => v.includes('-p06c-')).length === 1) expect(input.onContentDelta).toBeFunction()
      expect(input.maxOutputTokens).toBe(4320)
      expect(input.maxProviderAttempts).toBe(1)
      expect(input.maxProviderModels).toBe(1)
      expect(payload.entries).toBeDefined()
      const entries = payload.entries!.map(entry => {
        const fact = entry.facts.find(f => entry.coreEvidenceIds.includes(f.evidenceId)) ?? entry.facts[0]
        const paragraphs = entry.section === 'experience'
          ? [{ role: 'contribution', text: '参与团队产品迭代。', evidenceIds: [fact.evidenceId] },
            { role: 'outcome', text: '团队交付3个功能。', evidenceIds: [fact.evidenceId] }]
          : [{ role: 'detail', text: fact.text, evidenceIds: [fact.evidenceId] }]
        if (variant === 'foreign_reference') paragraphs[0].evidenceIds = ['foreign-project']
        return { entryId: entry.entryId, paragraphs }
      })
      if ((variant === 'corrected_number' && versions.filter(v => v.includes('-p06c-')).length === 1) || variant === 'uncorrected_number') {
        entries[0].paragraphs[0].text += '新增999个用户。'
      }
      if (variant === 'missing_entry') entries.pop()
      if (variant === 'duplicate_entry') entries.push(structuredClone(entries[0]))
      if (variant === 'unknown_entry') entries[0].entryId = '私人姓名和联系方式'
      value = { contractVersion: ENTRY_WRITING_POLICY, entries: entries.map(entry => ({ ...entry,
        ...(variant === 'empty_note' ? { entryIdNote: '' } : {}),
        ...(variant === 'nonempty_note' ? { entryIdNote: '不能丢弃的额外正文' } : {}),
        ...(variant === 'unknown_field' ? { extra: '' } : {}),
      })) }
      let content = JSON.stringify(value)
      if (variant === 'truncated') content = content.slice(0, -3)
      if (variant === 'empty_body') content = ''
      for (let i = 0; i < content.length; i += 9) input.onContentDelta?.(content.slice(i, i + 9))
      return { provider: 'fake', model: 'fixture', content, latencyMs: 1, physicalAttempts: 1,
        inputTokens: 30, outputTokens: 50, finishReason: variant === 'truncated' ? 'length' : 'stop' }
    } else throw new Error('UNEXPECTED_MODEL_STAGE')
    return { provider: 'fake', model: 'fixture', content: JSON.stringify(value), latencyMs: 1, physicalAttempts: 1 }
  } }
  const workflow = new V5ResumeOptimizationWorkflow({ provider, eventBus, enableDefaultSubscribers: false,
    artifactGenerationMode: 'writer_v1', jobTargetingPolicy: 'job-targeted-v1', entryWritingPolicy: ENTRY_WRITING_POLICY,
    onEntryStreamEvent: event => { events.push(event) } })
  const promise = workflow.run({ resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD })
  if (variant === 'valid' || variant === 'empty_note' || variant === 'corrected_number') {
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
    if (variant !== 'corrected_number') expect(events.some(event => event.type === 'entry.preview')).toBe(true)
    expect(events.at(-1)?.type).toBe('writer.completed')
    expect(validations.at(-1)?.payload).toMatchObject({ normalizationApplied: variant === 'empty_note',
      normalizationChanges: variant === 'empty_note' ? ['empty_entry_id_note_removed'] : [] })
  } else {
    await expect(promise).rejects.toThrow()
    expect(events.at(-1)?.type).toBe('writer.failed')
    expect(events.some(event => event.type === 'writer.completed')).toBe(false)
    if (variant === 'foreign_reference') expect(events.some(event => event.type === 'entry.preview')).toBe(false)
  }
  // Stage runner 既有的长度续写最多两次；结构错误不触发续写或修复。
  const writerCalls = variant === 'truncated' || variant === 'uncorrected_number' ? 3 : variant === 'corrected_number' ? 2 : 1
  expect(versions).toHaveLength(3 + writerCalls)
  expect(versions.filter(v => v.includes('-p06c-'))).toHaveLength(writerCalls)
  expect(versions.some(v => /-p0[589]-|-p12-|-p06d-/.test(v))).toBe(false)
  if (variant.endsWith('_entry')) {
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({type: 'writing.validation.observed',
      runId: expect.any(String), stepRunId: expect.any(String), attemptId: expect.any(String),
      payload: { code: 'ENTRY_SET_INVALID', passed: false,
        missingIds: variant === 'duplicate_entry' ? [] : [expect.any(String)],
        duplicateIds: variant === 'duplicate_entry' ? [expect.any(String)] : [] }})
    expect(JSON.stringify(diagnostics)).not.toContain('私人姓名和联系方式')
    expect(JSON.stringify(diagnostics)).not.toContain('产品迭代')
  } else expect(diagnostics).toHaveLength(0)
})
