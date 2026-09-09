import { expect, test } from 'bun:test'
import { createSingleStepFixture } from './single-step-fixtures'
import { FIXTURE_RESUME, FIXTURE_JD } from './fixtures'
import { toResumeAnalysis, toMatchAnalysis, toLegacyMvpProcessResponse } from '@/v5/main/compatibility'

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
  expect(versions[3]).toBe('5.2.0-p06c-entry-writer-r5')
  expect(result.state).toBe('succeeded')
  expect(toLegacyMvpProcessResponse(result).step3_optimized_resume).toContain('参与团队产品迭代')
  expect(result.matchScore).toEqual(matching.matchScore)

  await expect(createWorkflow().matchResume({resumeMarkdown: '其他简历内容', jobDescription: FIXTURE_JD}, extraction)).rejects.toBeDefined()
  expect(versions).toHaveLength(4)
})
