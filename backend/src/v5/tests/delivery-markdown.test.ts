import { expect, test } from 'bun:test'
import { deliveredResumeMarkdown } from '@/v5/delivery-markdown'
import { toLegacyMvpProcessResponse } from '@/v5/main/compatibility'
import { buildInterviewContext } from '@/v5/interview-context'
import { createV5ResultFixture } from './fixtures'

test('public output uses the skeleton while historical results retain artifact text', () => {
  const result = createV5ResultFixture()
  expect(deliveredResumeMarkdown(result)).toBe(result.artifact.markdown)
  result.deliveryMarkdown = `${result.artifact.markdown}\n- 【待完善：填实际交付；补明结果；无则删去本分句】`
  expect(toLegacyMvpProcessResponse(result).step3_optimized_resume).toBe(result.deliveryMarkdown)
  expect(result.artifact.markdown).not.toContain('【待完善')
  expect(JSON.stringify(buildInterviewContext(result))).not.toContain('【待完善')
})

test('interview rejects editorial claim text but retains its source evidence for preparation', () => {
  const result = createV5ResultFixture()
  const claim = result.artifact.claims.find(item => !/^identity/.test(item.outputPath))!
  claim.outputText += '【待完善：填真实交付名称；参考页面原型；无则删去分句】'
  const context = buildInterviewContext(result)
  expect(context.artifact.claims.some(item => item.claimId === claim.claimId)).toBe(false)
  expect(JSON.stringify(context.artifact)).not.toContain('页面原型')
  expect(context.resumeEvidenceBundle.evidenceAtoms.some(atom => claim.evidenceIds.includes(atom.evidenceId))).toBe(true)
})
