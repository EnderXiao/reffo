import {describe, expect, spyOn, test} from 'bun:test'
import {COMPLETION_TEMPLATES, createCompletionDocument, createPlainCompletionDocument, prepareResumeExport, serializeDraft, type ResumeCompletionDocument, type ResumeGapSegment} from '@/shared/resume-completion'
import {SqliteResumeHistoryRepository} from '@/repositories/resume-history-repository.sqlite'
import {SupabaseResumeHistoryRepository} from '@/repositories/resume-history-repository.supabase'
import type {ResumeHistoryRecord, SaveResumeHistoryInput} from '@/types'
import {assertResumeCompletionSnapshot, ResumeCompletionSnapshotError} from './resume-completion-snapshot'

function snapshot(document = createPlainCompletionDocument('- 负责需求分析。')): SaveResumeHistoryInput {
  const markdown = serializeDraft(document)
  return {id: 'completion-test', position: '产品经理', company: '示例公司', name: '示例候选人',
    created_at: '2026-11-10T00:00:00.000Z', quality_score: 70, match_score: 60, tags: [],
    resume_content: '示例源简历', jd_content: '示例目标岗位', optimized_content: markdown,
    process_result: {optimized: {optimized_resume: markdown, completion_document: document}}}
}

function metricDocument(fill: ResumeGapSegment['fill'], retainAnchor = true): ResumeCompletionDocument {
  const gap: ResumeGapSegment = {kind: 'optional_gap_clause', gapId: 'gap', template: 'metric_detail',
    ...COMPLETION_TEMPLATES.metric_detail, prefix: '，完成率从63.02%提升至', candidates: [], fill,
    retainedFacts: [{textSegmentId: 'baseline', exactText: '完成率基线为63.02%'}]}
  return createCompletionDocument({documentId: 'metric', blocks: [{blockId: 'row', kind: 'bullet', prefix: '- ', segments: [
    {kind: 'text', segmentId: 'baseline', markdown: retainAnchor ? '完成率基线为63.02%' : '推进任务系统上线', origin: 'user'},
    gap, {kind: 'text', segmentId: 'end', markdown: '。', origin: 'generated'},
  ]}]})
}

describe('历史填写快照一致性', () => {
  test('旧快照与结构一致的新快照均可保存', () => {
    expect(() => assertResumeCompletionSnapshot({optimized_content: '旧稿'})).not.toThrow()
    expect(() => assertResumeCompletionSnapshot(snapshot())).not.toThrow()
    expect(() => assertResumeCompletionSnapshot(snapshot(metricDocument({state: 'empty'})))).not.toThrow()
  })

  test('已有结构化记录不能被不携带文档的旧快照覆盖', () => {
    expect(() => assertResumeCompletionSnapshot({optimized_content: '旧客户端新正文',
      process_result: {optimized: {optimized_resume: '旧客户端新正文'}}}, snapshot())).toThrow('避免丢失已填写内容')
  })

  test('外层正文更新但嵌套结果未更新时明确拒绝', () => {
    expect(() => assertResumeCompletionSnapshot({...snapshot(), optimized_content: '只改正文'})).toThrow(ResumeCompletionSnapshotError)
    try { assertResumeCompletionSnapshot({...snapshot(), optimized_content: '只改正文'}) }
    catch (error) { expect(error).toMatchObject({code: 'RESUME_COMPLETION_MISMATCH', status: 409}) }
  })

  test('两份正文一致但仍携带旧文档时拒绝', () => {
    const input = snapshot()
    input.optimized_content = '新的正文'
    const result = input.process_result as {optimized: {optimized_resume: string}}
    result.optimized.optimized_resume = input.optimized_content
    expect(() => assertResumeCompletionSnapshot(input)).toThrow('正文与填写状态不一致')
  })

  test('未知版本及损坏结构返回422领域错误', () => {
    const input = snapshot()
    const result = input.process_result as {optimized: {completion_document: {schemaVersion: string}}}
    result.optimized.completion_document.schemaVersion = 'unknown'
    try { assertResumeCompletionSnapshot(input); throw new Error('expected rejection') }
    catch (error) { expect(error).toMatchObject({code: 'RESUME_COMPLETION_INVALID', status: 422}) }
  })

  test('缺少唯一基线的空指标分句不可保存', () => {
    expect(() => assertResumeCompletionSnapshot(snapshot(metricDocument({state: 'empty'}, false)))).toThrow('无法安全省略')
  })

  test('已填及已移除的历史锚点不会阻止保存', () => {
    for (const fill of [{state: 'filled', value: '88%', origin: 'user'}, {state: 'omitted'}] as const) {
      expect(() => assertResumeCompletionSnapshot(snapshot(metricDocument(fill, false)))).not.toThrow()
    }
  })

  test('旧标记逐行修复稿可保存，下载继续要求完成修复', () => {
    const document = createPlainCompletionDocument('- 已修复第一行。\n- 原始损坏标记【待完善：未知旧模板】')
    expect(() => assertResumeCompletionSnapshot(snapshot(document))).not.toThrow()
    expect(prepareResumeExport(document).ok).toBe(false)
  })

  test('SQLite合并部分更新后校验，不写入失配快照', () => {
    const repository = new SqliteResumeHistoryRepository()
    const existing = {...snapshot(), updated_at: '2026-11-10T00:00:00.000Z'} as ResumeHistoryRecord
    const find = spyOn(repository, 'findById').mockReturnValue(existing)
    try {
      expect(() => repository.update({userId: 'test', useServiceRole: true}, existing.id, {optimized_content: '孤立更新'})).toThrow('正文与填写状态不一致')
    } finally { find.mockRestore() }
  })

  test('Supabase合并部分更新后校验，不发送失配快照', async () => {
    const repository = new SupabaseResumeHistoryRepository()
    const existing = {...snapshot(), updated_at: '2026-11-10T00:00:00.000Z'} as ResumeHistoryRecord
    const find = spyOn(repository, 'findById').mockResolvedValue(existing)
    try {
      await expect(repository.update({userId: 'test', useServiceRole: true}, existing.id, {optimized_content: '孤立更新'})).rejects.toThrow('正文与填写状态不一致')
    } finally { find.mockRestore() }
  })

  test('两种仓储拒绝旧客户端整包省略文档，包括同ID保存', async () => {
    const existing = {...snapshot(), updated_at: '2026-11-10T00:00:00.000Z'} as ResumeHistoryRecord
    const olderInput = {...snapshot(), optimized_content: '新正文', process_result: {optimized: {optimized_resume: '新正文'}}}
    const context = {userId: 'test', useServiceRole: true}
    const sqlite = new SqliteResumeHistoryRepository()
    const localFind = spyOn(sqlite, 'findById').mockReturnValue(existing)
    try {
      expect(() => sqlite.save(context, olderInput)).toThrow('避免丢失已填写内容')
      expect(() => sqlite.update(context, existing.id, olderInput)).toThrow('避免丢失已填写内容')
    } finally { localFind.mockRestore() }
    const supabase = new SupabaseResumeHistoryRepository()
    const cloudFind = spyOn(supabase, 'findById').mockResolvedValue(existing)
    try {
      await expect(supabase.save(context, olderInput)).rejects.toThrow('避免丢失已填写内容')
      await expect(supabase.update(context, existing.id, olderInput)).rejects.toThrow('避免丢失已填写内容')
    } finally { cloudFind.mockRestore() }
  })
})
