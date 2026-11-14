import {expect, test} from 'bun:test'
import {createV5ResultFixture} from './fixtures'
import {validateGeneratedResumeArtifact} from '@/v5/validators'

function stageIssues(output: string, source: string) {
  const result = createV5ResultFixture()
  const evidenceId = result.resumePlan.stableCoreEvidenceIds[0]
  const atom = result.resumeEvidenceBundle.evidenceAtoms.find(item => item.evidenceId === evidenceId)!
  atom.verbatimText = source
  atom.normalizedClaim = source
  atom.riskFlags = ['future_or_planned']
  atom.numericAtoms = []
  const claim = result.artifact.claims.find(item => item.evidenceIds.includes(evidenceId))!
  result.artifact.markdown = result.artifact.markdown.replace(claim.outputText, output)
  claim.outputText = output
  return validateGeneratedResumeArtifact({artifact: result.artifact, resume: result.resumeEvidenceBundle,
    plan: result.resumePlan, policy: result.generationPolicy, gateMode: 'relaxed_release'})
    .issues.filter(issue => issue.code === 'STAGE_UPGRADE')
}

const source = '规则配置优化已上线；执行体验与跨端口径统一已评审、开发中。后续状态治理仍待推进。'
test('keeps exact mixed completed and in-progress source clauses without a false stage upgrade', () => {
  expect(stageIssues(source, source)).toEqual([])
})

test.each([
  '规则配置、执行体验与跨端口径统一已上线。',
  '规则配置优化已上线；执行体验与跨端口径统一已评审、开发中。后续状态治理已完成。',
  '规则配置优化已上线；执行体验与跨端口径统一已上线。其他项目开发中。',
])('does not accept dropped or unrelated in-progress qualifiers: %s', output => {
  expect(stageIssues(output, source)).toHaveLength(1)
})

test('does not introduce in-progress wording absent from the referenced source', () => {
  expect(stageIssues('执行体验开发中。', '执行体验尚未启动。')).toHaveLength(1)
})
