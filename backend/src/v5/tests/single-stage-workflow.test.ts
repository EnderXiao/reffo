import { expect, test } from 'bun:test'
import { createSingleStepFixture } from './single-step-fixtures'
import { FIXTURE_RESUME, FIXTURE_JD } from './fixtures'
import { createTargetingFixture } from './targeting-fixtures'
import { createHarnessEventBus } from '@/harness/event-bus'
import type { HarnessEvent } from '@/harness/events'
import type { ChatCompletionInput, ChatCompletionResult, LlmProvider } from '@/providers/llm-provider'
import { toResumeAnalysis, toMatchAnalysis, toLegacyMvpProcessResponse } from '@/v5/main/compatibility'
import { V5ResumeOptimizationWorkflow } from '@/v5/main/workflow'
import { ENTRY_WRITING_POLICY } from '@/v5/writing/entries'

test('V5 single stages reuse validated checkpoints without repeating model stages', async () => {
  const {createWorkflow, versions} = createSingleStepFixture()
  const extraction = await createWorkflow().extractResume({resumeMarkdown: FIXTURE_RESUME})
  expect(versions).toHaveLength(1)
  expect(versions[0]).toContain('-p01-')
  expect(toResumeAnalysis(extraction).structured_resume.personal_info.name).toBe('张三')

  const matching = await createWorkflow().matchResume({resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD}, extraction)
  expect(versions).toHaveLength(3)
  expect(versions[1]).toContain('-p02-')
  expect(versions[2]).toContain('-p03-')
  expect(matching.state).toBe('matched')
  const legacyMatch = toMatchAnalysis({...matching, resumeEvidenceBundle: extraction.resumeEvidenceBundle})
  expect(legacyMatch.match_score).toBe(matching.matchScore.score)
  expect(legacyMatch.requirement_analysis).toBeDefined()

  const result = await createWorkflow().generateResume(matching)
  expect(versions).toHaveLength(4)
  expect(versions[3]).toBe('5.2.0-p06c-entry-writer-r8')
  expect(result.state).toBe('succeeded')
  expect(toLegacyMvpProcessResponse(result).step3_optimized_resume).toContain('参与团队产品迭代')
  expect(result.matchScore).toEqual(matching.matchScore)

  await expect(createWorkflow().matchResume({resumeMarkdown: '其他简历内容', jobDescription: FIXTURE_JD}, extraction)).rejects.toBeDefined()
  expect(versions).toHaveLength(4)
})

test('targeted match recovers P03 reasoning-only truncation with one thinking-disabled call', async () => {
  const {createWorkflow} = createSingleStepFixture()
  const extraction = await createWorkflow().extractResume({resumeMarkdown: FIXTURE_RESUME})
  const fixture = createTargetingFixture()
  const requests: ChatCompletionInput[] = []
  const eventBus = createHarnessEventBus()
  const events: HarnessEvent[] = []
  eventBus.subscribe('*', event => { events.push(event) })
  const result = (content: unknown, finishReason = 'stop'): ChatCompletionResult => ({
    provider: 'fake',
    model: 'fixture',
    content: JSON.stringify(content),
    finishReason,
    latencyMs: 1,
    inputTokens: 10,
    outputTokens: 10,
  })
  const provider: LlmProvider = {
    complete: async input => {
      requests.push(input)
      const version = input.promptVersion ?? ''
      if (version.includes('-p02-')) return result(fixture.candidate)
      if (version.includes('-p03')) {
        const p03Calls = requests.filter(request => (request.promptVersion ?? '').includes('-p03')).length
        if (p03Calls === 1) {
          return {
            provider: 'fake',
            model: 'fixture',
            content: '',
            finishReason: 'length',
            latencyMs: 26,
            inputTokens: 29_278,
            outputTokens: 6_000,
            reasoningTokens: 6_000,
          }
        }
        const userContent = input.messages.find(message => message.role === 'user')?.content ?? ''
        const match = userContent.match(/UNTRUSTED_INPUT_JSON:\n([\s\S]+?)\n\n只返回本阶段/)
        if (!match) throw new Error('P03 fixture is missing the stage envelope')
        const payload = JSON.parse(match[1]).payload as {
          targets: Array<{ id: string }>
          resumeContext: { facts: Array<{ evidenceId: string; claimType: string }> }
        }
        const fact = payload.resumeContext.facts.find(item => item.claimType === 'deliverable')!
        return result({
          contractVersion: 'job-fit-map-v1',
          links: payload.targets.map(target => ({
            targetId: target.id,
            status: 'transferable',
            evidenceIds: [fact.evidenceId],
            similarity: '具有相邻产品实践。',
            difference: '尚不等于完整岗位经验。',
            expressionAngle: '突出已有交付。',
          })),
          narratives: [],
          questions: [],
        })
      }
      throw new Error(`unexpected prompt: ${version}`)
    },
  }
  const workflow = new V5ResumeOptimizationWorkflow({
    provider,
    eventBus,
    enableDefaultSubscribers: false,
    artifactGenerationMode: 'writer_v1',
    jobTargetingPolicy: 'job-targeted-v1',
    entryWritingPolicy: ENTRY_WRITING_POLICY,
  })

  const matching = await workflow.matchResume({
    resumeMarkdown: FIXTURE_RESUME,
    jobDescription: FIXTURE_JD,
  }, extraction)

  expect(matching.state).toBe('matched')
  expect(matching.jobFitMap).toBeDefined()
  const p03Requests = requests.filter(request => (request.promptVersion ?? '').includes('-p03'))
  expect(p03Requests).toHaveLength(2)
  expect(p03Requests[0].thinkingOverride).toBeUndefined()
  expect(p03Requests[1]).toMatchObject({
    thinkingOverride: 'disabled',
    maxProviderAttempts: 1,
    maxProviderModels: 1,
    callMetadata: expect.objectContaining({
      callReason: 'thinking_fallback',
      repairScope: ['thinking_disabled'],
    }),
  })
  expect(events.filter(event => event.type.startsWith('recovery.'))).toHaveLength(3)
  expect(events.find(event => event.type === 'recovery.planned')?.payload).toMatchObject({
    action: 'disable_thinking',
    outputName: 'P03',
    triggerErrorCode: 'V5_OUTPUT_TRUNCATED',
    recoveryMode: 'thinking_disabled',
  })
})
