import {describe, expect, spyOn, test} from 'bun:test'
import {COMPLETION_TEMPLATES, applyCompletionCommand, createCompletionDocument, createPlainCompletionDocument, prepareResumeExport, serializeDraft, type ResumeCompletionDocument, type ResumeGapSegment} from '@/shared/resume-completion'
import {SqliteResumeHistoryRepository} from '@/repositories/resume-history-repository.sqlite'
import {SupabaseResumeHistoryRepository} from '@/repositories/resume-history-repository.supabase'
import type {ResumeHistoryRecord, SaveResumeHistoryInput} from '@/types'
import {assertResumeCompletionSnapshot, ResumeCompletionSnapshotError} from './resume-completion-snapshot'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

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

function v2Document(): ResumeCompletionDocument {
  const field = {kind: 'required_detail_gap' as const, gapId: 'definition', detailId: 'definition-detail',
    template: 'metric_definition' as const, ...COMPLETION_TEMPLATES.metric_definition, candidates: [], fill: {state: 'empty' as const}}
  return createCompletionDocument({schemaVersion: 'resume-completion-v2', documentId: 'completion-v2', blocks: [{
    blockId: 'v2-row', kind: 'bullet', prefix: '- ', segments: [
      {kind: 'text', segmentId: 'action', markdown: '搭建门店辅导流程', origin: 'generated'},
      {kind: 'dependent_claim', claimId: 'claim', sourceEvidenceIds: ['source-evidence-1'],
        sourceSpans: [{sourceBlockId: 'source-block-1', start: 0, end: 18}], readiness: 'metadata_missing',
        qualifiers: ['原材料记录'], parts: [
          {kind: 'text', segmentId: 'claim-result', markdown: '，原材料记录辅导有效率95%', origin: 'generated'},
          field,
          {kind: 'text', segmentId: 'claim-end', markdown: '。', origin: 'generated'},
        ], requiredGapIds: ['definition'], fillPolicy: 'all_required'},
    ],
  }]})
}

function editedV2(document: ResumeCompletionDocument, value: string) {
  const result = applyCompletionCommand(document, {documentId: document.documentId, baseRevision: document.revision,
    gapId: 'definition', type: 'fill', value})
  if (!result.ok || !result.operation) throw new Error('v2 fixture edit failed')
  return {document: result.document, operation: result.operation}
}

function v2Snapshot(document: ResumeCompletionDocument, baseline?: ResumeCompletionDocument,
  operation?: unknown): SaveResumeHistoryInput {
  const input = snapshot(document)
  input.id = 'completion-v2-history'
  input.completion_baseline = baseline
  input.completion_edit = operation ? {documentId: baseline?.documentId, baseRevision: baseline?.revision, operations: [operation]} : undefined
  return input
}

function createSupabaseRow(input: SaveResumeHistoryInput, updatedAt: string): Record<string, unknown> {
  return {id: input.id, user_id: 'test', position: input.position, company: input.company, name: input.name,
    created_at: input.created_at, updated_at: updatedAt, quality_score: input.quality_score,
    match_score: input.match_score, tags: input.tags, resume_content: input.resume_content,
    jd_content: input.jd_content, optimized_content: input.optimized_content,
    optimization_suggestions: null, changes_summary: null, process_result: input.process_result,
    result_context: null, progress: null, card_color: null, card_pattern: null}
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

  test('已有未知版本或损坏结构不能被有效的新文档覆盖', () => {
    for (const damaged of [{...v2Document(), schemaVersion: 'resume-completion-v99'},
      {...v2Document(), markdownFingerprint: 'damaged'}, {schemaVersion: 'resume-completion-v1'}, null]) {
      const previous = {process_result: {optimized: {completion_document: damaged}}}
      for (const next of [snapshot(), v2Snapshot(v2Document()), {optimized_content: '纯文本覆盖'}]) {
        expect(() => assertResumeCompletionSnapshot(next, previous)).toThrow('填写结构需要恢复')
      }
    }
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

describe('v2 completion persistence contract', () => {
  test('first v2 save requires an internal baseline and accepts a replayed edit', () => {
    const baseline = v2Document()
    const edited = editedV2(baseline, '按门店员工完成规定辅导后通过测评统计')
    const accepted = v2Snapshot(edited.document, baseline, edited.operation)
    expect(() => assertResumeCompletionSnapshot(accepted, null)).not.toThrow()
    expect(() => assertResumeCompletionSnapshot(v2Snapshot(edited.document), null)).toThrow('未找到服务端生成基准')
  })

  test('a forged dropped dependency and stale revision are rejected', () => {
    const baseline = v2Document()
    const edited = editedV2(baseline, '按门店员工完成规定辅导后通过测评统计')
    const forged = createCompletionDocument({schemaVersion: 'resume-completion-v2', documentId: baseline.documentId,
      blocks: [{blockId: 'v2-row', kind: 'bullet', prefix: '- ', segments: [
        {kind: 'text', segmentId: 'forged', markdown: '搭建门店辅导流程。', origin: 'user'},
      ]}]})
    expect(() => assertResumeCompletionSnapshot(v2Snapshot(forged, baseline), null)).toThrow('操作记录缺失')

    const stale = v2Snapshot(edited.document, baseline, edited.operation)
    const newerBase = {...baseline, revision: baseline.revision + 1}
    expect(() => assertResumeCompletionSnapshot(stale, {process_result: {optimized: {
      optimized_resume: serializeDraft(newerBase), completion_document: newerBase,
    }}})).toThrow('操作记录缺失')
  })

  test('an exact current snapshot is idempotent even when its original journal is retried', () => {
    const baseline = v2Document()
    const edited = editedV2(baseline, '按门店员工完成规定辅导后通过测评统计')
    const current = v2Snapshot(edited.document, baseline, edited.operation)
    expect(() => assertResumeCompletionSnapshot(current, {process_result: current.process_result})).not.toThrow()
  })

  test('SQLite accepts later v2 saves without a baseline and rejects a competing stale edit', () => {
    const directory = mkdtempSync(join(tmpdir(), 'reffo-completion-sqlite-'))
    const script = `
      import {applyCompletionCommand, COMPLETION_TEMPLATES, createCompletionDocument, serializeDraft} from './src/shared/resume-completion.ts'
      import {SqliteResumeHistoryRepository} from './src/repositories/resume-history-repository.sqlite.ts'
      const field = {kind: 'required_detail_gap', gapId: 'definition', detailId: 'definition-detail', template: 'metric_definition', ...COMPLETION_TEMPLATES.metric_definition, candidates: [], fill: {state: 'empty'}}
      const baseline = createCompletionDocument({schemaVersion: 'resume-completion-v2', documentId: 'sqlite-v2', blocks: [{blockId: 'row', kind: 'bullet', prefix: '- ', segments: [{kind: 'text', segmentId: 'action', markdown: '搭建门店辅导流程', origin: 'generated'}, {kind: 'dependent_claim', claimId: 'claim', sourceEvidenceIds: ['e1'], sourceSpans: [{sourceBlockId: 'source', start: 0, end: 18}], readiness: 'metadata_missing', qualifiers: ['原材料记录'], parts: [{kind: 'text', segmentId: 'result', markdown: '，原材料记录辅导有效率95%', origin: 'generated'}, field, {kind: 'text', segmentId: 'end', markdown: '。', origin: 'generated'}], requiredGapIds: ['definition'], fillPolicy: 'all_required'}]}]})
      const edit = value => { const result = applyCompletionCommand(baseline, {documentId: baseline.documentId, baseRevision: baseline.revision, gapId: 'definition', type: 'fill', value}); if (!result.ok) throw new Error('fixture edit failed'); return result }
      const input = (document, operation, firstSave = false) => ({id: 'sqlite-v2-history', position: '产品经理', company: '示例公司', name: '示例候选人', created_at: '2026-11-10T00:00:00.000Z', quality_score: 70, match_score: 60, tags: [], resume_content: '示例源简历', jd_content: '示例目标岗位', optimized_content: serializeDraft(document), process_result: {optimized: {optimized_resume: serializeDraft(document), completion_document: document}}, ...(firstSave ? {completion_baseline: baseline} : {}), ...(operation ? {completion_edit: {documentId: baseline.documentId, baseRevision: baseline.revision, operations: [operation]}} : {})})
      const repo = new SqliteResumeHistoryRepository()
      const context = {userId: 'sqlite-test', useServiceRole: true}
      const original = repo.save(context, input(baseline, undefined, true))
      const winnerEdit = edit('按门店员工完成规定辅导后通过测评统计')
      const laterInput = input(winnerEdit.document, winnerEdit.operation)
      const winner = repo.save(context, laterInput)
      const staleEdit = edit('按客户满意度问卷结果统计')
      let staleRejected = false
      try { repo.save(context, input(staleEdit.document, staleEdit.operation)) } catch (error) { staleRejected = error.status === 409 }
      const saved = repo.findById(context, original.id)
      const retry = repo.save(context, input(winnerEdit.document, winnerEdit.operation))
      console.log(JSON.stringify({id: original.id, laterInputHasBaseline: 'completion_baseline' in laterInput, winner: winner.optimized_content, staleRejected, stored: saved.optimized_content, retry: retry.optimized_content}))
    `
    try {
      const result = Bun.spawnSync([process.execPath, '-e', script], {cwd: join(import.meta.dir, '../..'),
        env: {...process.env, APP_ENV: 'local', DATABASE_PROVIDER: 'sqlite', SQLITE_DATABASE_PATH: join(directory, 'history.sqlite')},
        stdout: 'pipe', stderr: 'pipe'})
      expect(result.exitCode).toBe(0)
      const output = JSON.parse(result.stdout.toString()) as {id: string; laterInputHasBaseline: boolean; winner: string; staleRejected: boolean; stored: string; retry: string}
      expect(output.id).toBe('sqlite-v2-history')
      expect(output.laterInputHasBaseline).toBe(false)
      expect(output.staleRejected).toBe(true)
      expect(output.stored).toBe(output.winner)
      expect(output.retry).toBe(output.winner)
    } finally { rmSync(directory, {recursive: true, force: true}) }
  })

  test('Supabase later saves omit the baseline and CAS reports a concurrent update', () => {
    const baseline = v2Document()
    const edited = editedV2(baseline, '按门店员工完成规定辅导后通过测评统计')
    const existing = {...snapshot(baseline), id: 'completion-v2-history', updated_at: '2026-11-10T01:00:00.000Z'} as ResumeHistoryRecord
    const laterInput = v2Snapshot(edited.document, baseline, edited.operation)
    delete laterInput.completion_baseline
    expect(laterInput).not.toHaveProperty('completion_baseline')
    // Route suites replace the Supabase module process-wide; exercise the real REST client in isolation.
    const script = `
      import {SupabaseResumeHistoryRepository} from './src/repositories/resume-history-repository.supabase.ts'
      const fixture = JSON.parse(process.env.REFFO_COMPLETION_CAS_FIXTURE)
      const originalFetch = globalThis.fetch
      const requests = []
      globalThis.fetch = async (input, init) => {
        requests.push({url: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined})
        const payload = String(input).includes('/rpc/commit_resume_history') ? {conflict: 'version'} : [fixture.existing]
        return new Response(JSON.stringify(payload), {status: 200, headers: {'Content-Type': 'application/json'}})
      }
      let rejection = null
      try {
        await new SupabaseResumeHistoryRepository().save({userId: 'test', useServiceRole: true}, fixture.laterInput)
      } catch (error) {
        rejection = {code: error.code, status: error.status}
      } finally {
        globalThis.fetch = originalFetch
      }
      console.log(JSON.stringify({requests, rejection}))
    `
    const result = Bun.spawnSync([process.execPath, '-e', script], {cwd: join(import.meta.dir, '../..'),
      env: {...process.env, APP_ENV: 'local', DATABASE_PROVIDER: 'sqlite', SUPABASE_URL: 'http://127.0.0.1',
        REFFO_COMPLETION_CAS_FIXTURE: JSON.stringify({laterInput, existing: createSupabaseRow(existing, existing.updated_at)})},
      stdout: 'pipe', stderr: 'pipe'})
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout.toString()) as {requests: Array<{url: string; method: string; body?: {p_expected?: unknown}}>; rejection: unknown}
    expect(output.rejection).toEqual({code: 'RESUME_VERSION_CONFLICT', status: 409})
    expect(output.requests.map(request => request.method)).toEqual(['GET', 'POST'])
    expect(new URL(output.requests[1]!.url).pathname).toBe('/rest/v1/rpc/commit_resume_history')
    expect(output.requests[1]!.body?.p_expected).toEqual({documentId: baseline.documentId, revision: baseline.revision, resolvedDigest: null, updatedAt: existing.updated_at})
  })
})
