import { expect, test } from 'bun:test'
import { createSingleStepFixture } from './single-step-fixtures'
import { FIXTURE_RESUME, FIXTURE_JD } from './fixtures'
import { createTargetingFixture } from './targeting-fixtures'
import type { HarnessEvent } from '@/harness/events'
import type { ChatCompletionInput, LlmProvider } from '@/providers/llm-provider'
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
  expect(versions[3]).toBe('5.7.0-p06c-entry-routed-v6-r10')
  expect(result.state).toBe('succeeded')
  expect(toLegacyMvpProcessResponse(result).step3_optimized_resume).toContain('参与团队产品迭代')
  expect(result.matchScore).toEqual(matching.matchScore)

  await expect(createWorkflow().matchResume({resumeMarkdown: '其他简历内容', jobDescription: FIXTURE_JD}, extraction)).rejects.toBeDefined()
  expect(versions).toHaveLength(4)
})

test('targeted matching recovers a malformed nested aspect with one scoped repair and full revalidation', async () => {
  const extraction = await createSingleStepFixture().createWorkflow().extractResume({resumeMarkdown: FIXTURE_RESUME})
  const fixture = createTargetingFixture(), requests: ChatCompletionInput[] = []
  let validFit: unknown
  const provider: LlmProvider = {complete: async input => {
    requests.push(input)
    const version = input.promptVersion ?? ''
    let content: unknown
    if (version.includes('-p02-')) content = fixture.candidate
    else if (version.includes('-p03-')) {
      const raw = input.messages.find(message => message.role === 'user')!.content.match(/UNTRUSTED_INPUT_JSON:\n([\s\S]+?)\n\n只返回本阶段/)![1]!
      const payload = JSON.parse(raw).payload as {targets: Array<{id: string}>; resumeContext: {facts: Array<{evidenceId: string; claimType: string}>}}
      const fact = payload.resumeContext.facts.find(item => item.claimType === 'deliverable')!
      const fit = {contractVersion: 'job-fit-map-v2', links: payload.targets.map(target => ({targetId: target.id,
        status: 'transferable', evidenceIds: [fact.evidenceId], similarity: '已有相邻产品实践。', difference: '业务对象不同。',
        expressionAngle: '保留真实参与的交付。', supportedAspects: [{text: '参与产品迭代。', evidenceIds: [fact.evidenceId]}],
        unprovenAspects: [], roleBoundary: '团队参与。', supportRelation: 'domain_transfer'})), narratives: [], questions: []}
      validFit = structuredClone(fit)
      content = {...fit, links: fit.links.map((link, index) => index ? link : {...link, supportedAspects: [{text: '参与产品迭代。'}]})}
    } else if (version.includes('-p03r-')) {
      const raw = input.messages.find(message => message.role === 'user')!.content.match(/UNTRUSTED_INPUT_JSON:\n([\s\S]+?)\n\n只返回本阶段/)![1]!
      const payload = JSON.parse(raw).payload
      expect(payload.originalEnvelope.payload.targets).toHaveLength(1)
      const ids = new Set(payload.originalEnvelope.payload.repairScope.targetIds)
      const fit = validFit as {links: Array<{targetId: string}>}
      content = {...fit, links: fit.links.filter(link => ids.has(link.targetId))}
    } else throw new Error(`unexpected ${version}`)
    return {provider: 'fake', model: 'fixture', content: JSON.stringify(content), finishReason: 'stop', latencyMs: 1}
  }}
  const workflow = new V5ResumeOptimizationWorkflow({provider, enableDefaultSubscribers: false, artifactGenerationMode: 'writer_v1',
    jobTargetingPolicy: 'job-targeted-v2', entryWritingPolicy: ENTRY_WRITING_POLICY})
  const result = await workflow.matchResume({resumeMarkdown: FIXTURE_RESUME, jobDescription: FIXTURE_JD}, extraction)
  expect(result.state).toBe('matched')
  expect(result.jobFitMap!.links.length).toBeGreaterThan(1)
  expect(requests.filter(request => request.promptVersion?.includes('-p03r-'))).toHaveLength(1)
})
