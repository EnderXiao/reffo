import {describe, expect, test} from 'bun:test'
import type {ResumeHistoryRecord} from '@/types'
import type {ShareLinkRecord} from '@/types/share-link'
import type {ShareLinkRepositoryContract} from '@/repositories/share-link-repository'
import {projectResumeHistoryScore} from '@/services/resume-history-score'
import {ShareLinkService} from '@/services/share-link-service'
import {publicResumeHistory, toSummary} from '@/routes/resume-history'
import {createPlainCompletionDocument} from '@/shared/resume-completion'
import {interviewGenerationBasis, savedInterviewGenerationBasis} from '@/v5/current-interview-snapshot'
import {calculateV5MatchScore} from '@/v5/match-score'
import {projectLegacyMatch} from '@/v5/targeting/fit'
import {createTargetingFixture} from '@/v5/tests/targeting-fixtures'
import {createV5ResultFixture} from '@/v5/tests/fixtures'

function fixture() {
  const source = createTargetingFixture()
  const skillRequirement = source.job.requirementAtoms.find(item => item.importance === 'must_have')!
  source.fit.links.find(item => item.targetId === skillRequirement.requirementId)!.status = 'direct'
  const generated = createV5ResultFixture()
  generated.resumeEvidenceBundle = source.resume
  generated.jobRequirementBundle = source.job
  generated.matchAnalysis = projectLegacyMatch(source.fit, source.targets, source.resume, source.job)
  const document = createPlainCompletionDocument('# 示例姓名\n- 参与产品交付。')
  const history: ResumeHistoryRecord = {
    id: 'history-score', position: '产品经理', company: '示例公司', name: '示例姓名',
    created_at: '2026-11-14T00:00:00Z', updated_at: '2026-11-14T00:00:00Z',
    quality_score: 80, match_score: null, tags: [], resume_content: '源简历', jd_content: '目标岗位', optimized_content: '当前简历',
    commit_ack: {commit_id: 'commit-score', document_id: document.documentId, revision: document.revision, resolved_digest: 'stable-digest'},
    process_result: {matching: {match_score: null, score_formula_version: 'match-score-v2', score_calibration_status: 'pending', strengths: ['保留原分析']},
      optimized: {completion_document: document},
      server_interview_basis: {version: 'interview-generation-basis-v1', result: interviewGenerationBasis(generated)}},
  }
  return {history, generated, document}
}

const processResult = (history: ResumeHistoryRecord) => history.process_result as {
  matching: {match_score: number | null; score_formula_version: string; score_calibration_status: string; score_basis?: string; score_confidence?: string; strengths: string[]}
  optimized: {completion_document: unknown}
  server_interview_basis?: unknown
}

describe('历史评分只读投影', () => {
  test('真实持久化 match 的 actionPlan sidecar 不阻塞 canonical 评分且仍保留原计划', () => {
    const {history} = fixture()
    const basis = savedInterviewGenerationBasis(history)!
    const sidecar = {version: 'resume-action-plan-v1', actions: [{actionId: 'keep-source', text: '保留源材料证据'}]}
    Object.assign(basis.matchAnalysis, {actionPlan: sidecar})
    const before = structuredClone(history)
    const projected = projectResumeHistoryScore(history)
    expect(typeof projected.match_score).toBe('number')
    expect(toSummary(history).match_score).toBe(projected.match_score)
    expect(publicResumeHistory(history).match_score).toBe(projected.match_score)
    expect(savedInterviewGenerationBasis(projected)!.matchAnalysis).toHaveProperty('actionPlan', sidecar)
    expect(history).toEqual(before)
  })

  test('可信 v2 历史在摘要与详情返回相同新评分，同时保留原文档和提交确认', () => {
    const {history, generated, document} = fixture()
    const before = structuredClone(history)
    const expected = calculateV5MatchScore({resume: generated.resumeEvidenceBundle, job: generated.jobRequirementBundle, match: generated.matchAnalysis})
    expect(typeof expected.score).toBe('number')
    const projected = projectResumeHistoryScore(history)
    const matching = processResult(projected).matching
    expect(projected.match_score).toBe(expected.score)
    expect(matching).toMatchObject({match_score: expected.score, score_formula_version: 'match-score-v3', score_calibration_status: 'rules_based',
      score_basis: 'current_material_requirement_coverage', score_confidence: expected.confidence, strengths: ['保留原分析']})
    expect(toSummary(history).match_score).toBe(expected.score)
    const publicHistory = publicResumeHistory(history)
    expect(publicHistory.match_score).toBe(expected.score)
    expect(processResult(publicHistory).matching).toEqual(matching)
    expect(processResult(publicHistory)).not.toHaveProperty('server_interview_basis')
    expect(processResult(projected).optimized.completion_document).toBe(document)
    expect(projected.commit_ack).toBe(history.commit_ack)
    expect(projected.updated_at).toBe(history.updated_at)
    expect(history).toEqual(before)
  })

  test('已评分记录包括零分及 v1 记录完全不变', () => {
    const {history} = fixture()
    for (const score of [0, 84]) {
      const existing = {...history, match_score: score}
      expect(projectResumeHistoryScore(existing)).toBe(existing)
    }
    processResult(history).matching.score_formula_version = 'match-score-v1'
    expect(projectResumeHistoryScore(history)).toBe(history)
  })

  test('缺失、过期或不完整的服务端 basis 不从公共分析反推评分', () => {
    const {history} = fixture()
    const result = processResult(history)
    const valid = structuredClone(result.server_interview_basis)
    for (const basis of [undefined, {version: 'unknown', result: valid},
      {version: 'interview-generation-basis-v1', result: {runId: 'incomplete', artifact: {claims: []}, resumeEvidenceBundle: {evidenceAtoms: []},
        jobRequirementBundle: {requirementAtoms: []}, matchAnalysis: {requirementMatches: [], judgmentBundle: {items: []}}}}]) {
      result.server_interview_basis = basis
      expect(projectResumeHistoryScore(history)).toBe(history)
    }
    result.server_interview_basis = valid
    delete savedInterviewGenerationBasis(history)!.matchAnalysis.judgmentBundle
    expect(projectResumeHistoryScore(history)).toBe(history)
  })

  test('格式错误的嵌套判断安全保留待评估，不使历史列表失败', () => {
    const {history} = fixture()
    const basis = savedInterviewGenerationBasis(history)!
    const malformed = basis.matchAnalysis.judgmentBundle!.items[0]! as unknown as Record<string, unknown>
    malformed.supportedAspects = null
    expect(() => toSummary(history)).not.toThrow()
    expect(toSummary(history).match_score).toBeNull()
    expect(projectResumeHistoryScore(history)).toBe(history)
  })

  test('全部未知继续待评估，部分未知仍返回当前材料分且不改写未知判断', () => {
    const {history} = fixture()
    const basis = savedInterviewGenerationBasis(history)!
    const items = basis.matchAnalysis.judgmentBundle!.items
    const original = structuredClone(items)
    items[0]!.status = 'unproven'
    const partial = projectResumeHistoryScore(history)
    expect(typeof partial.match_score).toBe('number')
    expect(processResult(partial).matching.score_confidence).toBe('low')
    items.forEach(item => {item.status = 'unproven'})
    const unknown = projectResumeHistoryScore(history)
    expect(unknown.match_score).toBeNull()
    expect(processResult(unknown).matching).toMatchObject({match_score: null, score_formula_version: 'match-score-v3', score_confidence: 'low'})
    expect(items.map(item => item.requirementId)).toEqual(original.map(item => item.requirementId))
    expect(items.every(item => item.status === 'unproven')).toBe(true)
  })

  test('新分享复用历史投影，但已有分享始终保留冻结快照', async () => {
    const {history} = fixture()
    const before = structuredClone(history)
    const records: ShareLinkRecord[] = []
    const repository: ShareLinkRepositoryContract = {
      create: (_context, input) => {
        const created: ShareLinkRecord = {...input, revoked_at: null, created_at: history.created_at, updated_at: history.updated_at,
          last_viewed_at: null, view_count: 0}
        records.push(created)
        return created
      },
      findByTokenHash: () => null,
      findActive: () => records[0] ?? null,
      findByIdempotencyKeyHash: () => records[0] ?? null,
      revoke: () => false,
    }
    const service = new ShareLinkService(repository)
    const context = {userId: 'score-owner', useServiceRole: true}
    const first = await service.create(context, history, 'job', 'link')
    expect(first.created).toBe(true)
    expect(records[0]!.snapshot.card).toMatchObject({kind: 'job', match_score: projectResumeHistoryScore(history).match_score})
    const frozen = structuredClone(records[0]!.snapshot)
    savedInterviewGenerationBasis(history)!.matchAnalysis.judgmentBundle!.items.forEach(item => {item.status = 'direct'})
    const second = await service.create(context, history, 'job', 'link')
    expect(second.created).toBe(false)
    expect(records[0]!.snapshot).toEqual(frozen)
    expect(records).toHaveLength(1)
    expect(before.match_score).toBeNull()
    expect(history.match_score).toBeNull()
  })
})
