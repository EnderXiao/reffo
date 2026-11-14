import {describe, expect, test} from 'bun:test'
import {ResumeExportService} from './resume-export-service'
import {createCompletionDocument, createPlainCompletionDocument, serializeDraft} from '@/shared/resume-completion'
import type {ResumeExportRow, ResumeExportStorage} from '@/repositories/resume-export-repository'
import type {ResumeHistoryRecord} from '@/types'
import {renderResumeHtml, resumePdfBlocks} from './pdf/resume-template'

function setup(markdown = '# 示例姓名\n13800000000\n## 工作经历\n- 负责需求分析与验收。') {
  const plain = createPlainCompletionDocument(markdown)
  const document = createCompletionDocument({...plain, blocks: plain.blocks.map(block => ({...block,
    segments: block.segments.map(segment => segment.kind === 'text' ? {...segment, origin: 'generated' as const} : segment)}))})
  let history: ResumeHistoryRecord | null = {id: 'history', position: '产品经理', company: '示例公司', name: '', created_at: '2026-11-12', updated_at: '2026-11-12',
    quality_score: 70, match_score: 60, tags: [], resume_content: markdown, jd_content: '目标职责', optimized_content: serializeDraft(document),
    process_result: {optimized: {optimized_resume: serializeDraft(document), completion_document: document, identity_state: {name: 'known'},
      action_review: {outcomes: [{state: 'adopted', validation: 'deterministic'}]},
      change_manifest: {structureBasis: {version: 'resume-structure-basis-v1', sourceRevision: 'source', nodes: [], sourceSectionTitles: []}, structureChanges: []},
      delivery_state: {version: 'resume-delivery-state-v1', state: 'application_ready', gates: [
        {gate: 'fact', state: 'pass', reasons: []}, {gate: 'supplement', state: 'pass', reasons: []}]}}}}
  const rows = new Map<string, ResumeExportRow>()
  let calls = 0
  let renderHook: (()=>void)|undefined
  const storage: ResumeExportStorage = {
    findRequest: async (owner, request) => [...rows.values()].find(row => row.owner_id === owner && row.request_id === request) ?? null,
    find: async (owner, id) => {const row = rows.get(id); return row?.owner_id === owner ? row : null},
    insert: async row => {rows.set(row.id, structuredClone(row)); return row},
    finish: async (owner, id, status, file) => {const row = rows.get(id); if (!row || row.owner_id !== owner || row.status !== 'pending' || Date.parse(row.expires_at)<=Date.now()) return null
      const next = {...row, status, file_base64: file, model: null}; rows.set(id, next); return next},
    revokeHistory: async owner => {for (const [id, row] of rows) if (row.owner_id === owner) rows.set(id, {...row, status: 'revoked', model: null, file_base64: null})},
    cleanup: async () => {},
  }
  const service = new ResumeExportService({findById: async context => context.userId === 'owner' ? history : null}, storage,
    {render: async () => {calls++;renderHook?.(); return new TextEncoder().encode('%PDF-test')}}, 900000)
  const input = {request_id: 'export-request', document_id: document.documentId, expected_revision: document.revision, format: 'pdf' as const}
  return {service, input, rows, document, context: {userId: 'owner', useServiceRole: true}, calls: () => calls,
    deleteHistory: () => {history = null},markPartial:()=>{const result=history!.process_result as {optimized:{delivery_state?:unknown}};result.optimized.delivery_state={state:'partial_recovery'}},onRender:(hook:()=>void)=>{renderHook=hook}}
}

describe('saved resume PDF export', () => {
  test('freezes current document, uses current heading name, and reuses identical requests', async () => {
    const harness = setup()
    const first = await harness.service.create(harness.context, 'history', harness.input)
    const second = await harness.service.create(harness.context, 'history', harness.input)
    expect(first).toEqual(second)
    expect(first.disposition).toBe('application_ready')
    expect(first.file_name).toBe('示例姓名_产品经理.pdf')
    expect(first.delivery_state.gates).toHaveLength(6)
    expect(first.delivery_state.gates.find(gate => gate.gate === 'pdf')?.state).toBe('pass')
    expect(harness.calls()).toBe(1)
    expect([...harness.rows.values()][0]!.model).toBeNull()
    expect((await harness.service.file(harness.context, 'history', first.export_id)).bytes).toHaveLength(9)
  })
  test('missing name produces a downloadable draft without guessing from history metadata', async () => {
    const harness = setup('# Resume\n13800000000\n- 负责需求分析。')
    const exported = await harness.service.create(harness.context, 'history', harness.input)
    expect(exported.disposition).toBe('draft_only')
    expect(exported.reason_codes).toContain('NAME_MISSING')
    expect(exported.file_name).toStartWith('待完善简历_产品经理_')
  })
  test('rejects stale versions and owner access; deletion immediately removes file access', async () => {
    const harness = setup()
    await expect(harness.service.create(harness.context, 'history', {...harness.input, expected_revision: 7})).rejects.toMatchObject({status: 409})
    const exported = await harness.service.create(harness.context, 'history', harness.input)
    await expect(harness.service.file({userId: 'other', useServiceRole: true}, 'history', exported.export_id)).rejects.toMatchObject({status: 404})
    harness.deleteHistory()
    await expect(harness.service.file(harness.context, 'history', exported.export_id)).rejects.toMatchObject({status: 404})
  })
  test('request id reuse with changed content is rejected', async () => {
    const harness = setup()
    await harness.service.create(harness.context, 'history', harness.input)
    await expect(harness.service.create(harness.context, 'history', {...harness.input, format: 'markdown' as 'pdf'})).rejects.toMatchObject({status: 409})
  })
  test('cleaned partial recovery remains a downloadable draft with complete identity',async()=>{
    const harness=setup();harness.markPartial()
    const result=await harness.service.create(harness.context,'history',harness.input)
    expect(result.disposition).toBe('draft_only')
    expect(result.reason_codes).toContain('CONTENT_INCOMPLETE')
    expect(result.file_name).toStartWith('待完善简历_')
  })
  test('a deletion during rendering revokes the immutable snapshot and cannot resurrect the file',async()=>{
    const harness=setup()
    harness.onRender(()=>harness.deleteHistory())
    await expect(harness.service.create(harness.context,'history',harness.input)).rejects.toMatchObject({status:404})
    const row=[...harness.rows.values()][0]!
    expect(row.status).toBe('revoked');expect(row.file_base64).toBeNull();expect(row.model).toBeNull()
  })
  test('an expired rendering lease cannot publish its file',async()=>{
    const harness=setup()
    harness.onRender(()=>{for(const [id,row] of harness.rows)harness.rows.set(id,{...row,expires_at:new Date(Date.now()-1).toISOString()})})
    await expect(harness.service.create(harness.context,'history',harness.input)).rejects.toMatchObject({status:410})
    expect([...harness.rows.values()][0]!.file_base64).toBeNull()
  })
  test('template renders text and escapes active markup and external resources', () => {
    const html = renderResumeHtml({version: 'resume-pdf-model-v1', disposition: 'draft_only', title: '<script>', blocks: resumePdfBlocks('# 测试\n- <img src="https://example.invalid/private">\n- **已知事实**')})
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
    expect(html).toContain('待完善稿')
    expect(html).toContain('已知事实')
    expect(html).not.toContain('**已知事实**')
  })
})
