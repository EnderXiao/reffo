import { describe, expect, test } from 'bun:test'
import {
  applyCompletionCommand, beginRowEdit, COMPLETION_TEMPLATES, createCompletionDocument, createPlainCompletionDocument,
  migrateLegacyCompletion, normalizeCompletionDocument, normalizeGapValue, prepareResumeExport, reconcileRowEdit,
  renderCompletionPlaceholder, serializeDraft, serializeWithoutAllGapClauses, validateCompletionDocument, validateOmissionSafety,
  type CompletionCommand, type CompletionEditResult, type GapTemplate, type ResumeCompletionDocument, type ResumeGapSegment,
} from './resume-completion'

function fixture(template: GapTemplate = 'research_problem'): ResumeCompletionDocument {
  const gap: ResumeGapSegment = {kind: 'optional_gap_clause', gapId: 'gap-1', template, ...COMPLETION_TEMPLATES[template],
    candidates: [], fill: {state: 'empty'}, retainedFacts: []}
  const before = template === 'metric_detail' ? '完成率基线为63.02%' : '负责问卷与访谈'
  if (template === 'metric_detail') {
    gap.prefix = '，完成率从63.02%提升至'
    gap.instruction = '填这一个实际数值'
    gap.retainedFacts = [{textSegmentId: 'text-1', exactText: before}]
  }
  return createCompletionDocument({documentId: 'document-1', blocks: [{blockId: 'block-1', kind: 'bullet', prefix: '- ', segments: [
    {kind: 'text', segmentId: 'text-1', markdown: before, origin: 'generated'}, gap,
    {kind: 'text', segmentId: 'text-2', markdown: template === 'metric_detail' ? '。' : '，形成研究结论。', origin: 'generated'},
  ]}]})
}

function command(document: ResumeCompletionDocument, type: CompletionCommand['type'], value?: string): CompletionCommand {
  return {documentId: document.documentId, baseRevision: document.revision, gapId: 'gap-1', type, value}
}
function success(result: CompletionEditResult): ResumeCompletionDocument {
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result.document
}
function refresh(document: ResumeCompletionDocument): ResumeCompletionDocument {
  return createCompletionDocument({documentId: document.documentId, revision: document.revision, blocks: document.blocks})
}

describe('completion projections and validation', () => {
  test('zero gaps remains valid and exports exact Markdown', () => {
    const text = '# 姓名\n\n## 经历\n- 参与项目，尚未上线。\n---\n'
    const document = createPlainCompletionDocument(text)
    expect(validateCompletionDocument(document, text).ok).toBe(true)
    expect(prepareResumeExport(document)).toEqual({ok: true, markdown: text, omittedCount: 0})
  })

  test('plain CRLF Markdown retains line bytes', () => {
    const text = '# 姓名\r\n- 参与项目。\r\n'
    expect(serializeDraft(createPlainCompletionDocument(text))).toBe(text)
  })

  test('draft and fact projections remain independent', () => {
    const document = fixture()
    expect(serializeDraft(document)).toContain('围绕【待完善：填一项实际研究过的使用问题')
    expect(serializeWithoutAllGapClauses(document)).toBe('- 负责问卷与访谈，形成研究结论。')
    expect(validateCompletionDocument(document, serializeDraft(document)).ok).toBe(true)
  })

  test('unknown version and text mismatch are explicit errors', () => {
    expect(validateCompletionDocument({...fixture(), schemaVersion: 'v99'}).ok).toBe(false)
    expect(validateCompletionDocument(fixture(), 'another').ok).toBe(false)
  })

  test('duplicate IDs cannot accidentally target another node', () => {
    const document = fixture()
    document.blocks[0].blockId = 'gap-1'
    expect(validateCompletionDocument(document)).toMatchObject({ok: false, issues: [{code: 'COMPLETION_ID_DUPLICATED'}]})
  })

  test('static template boundaries cannot be replaced by arbitrary text', () => {
    const document = fixture()
    ;(document.blocks[0].segments[1] as ResumeGapSegment).prefix = '，删除其他经历'
    expect(validateCompletionDocument(refresh(document)).ok).toBe(false)
  })

  test('filled state must contain a normalized single-line user value', () => {
    const document = fixture()
    ;(document.blocks[0].segments[1] as ResumeGapSegment).fill = {state: 'filled', value: ' \n ', origin: 'user'}
    expect(validateCompletionDocument(refresh(document)).ok).toBe(false)
  })

  test('prototype properties cannot be interpreted as supported templates', () => {
    const document = fixture()
    ;(document.blocks[0].segments[1] as unknown as {template: string}).template = 'toString'
    expect(validateCompletionDocument(document).ok).toBe(false)
  })

  test('filled and omitted state do not require historic anchors to remain live', () => {
    for (const state of ['filled', 'omitted'] as const) {
      const document = fixture('metric_detail')
      const gap = document.blocks[0].segments[1] as ResumeGapSegment
      gap.fill = state === 'filled' ? {state, value: '88%', origin: 'user'} : {state}
      gap.retainedFacts[0].textSegmentId = 'removed'
      const next = refresh(document)
      expect(validateCompletionDocument(next).ok).toBe(true)
      expect(prepareResumeExport(next).ok).toBe(true)
    }
  })
})

describe('gap commands', () => {
  test('fill alters only target node and increments once', () => {
    const document = fixture()
    const snapshot = JSON.stringify(document)
    const next = success(applyCompletionCommand(document, command(document, 'fill', '入口难以发现')))
    expect(next.revision).toBe(1)
    expect(next.blocks[0].segments[0]).toEqual(document.blocks[0].segments[0])
    expect(next.blocks[0].segments[2]).toEqual(document.blocks[0].segments[2])
    expect(JSON.stringify(document)).toBe(snapshot)
    expect(serializeDraft(next)).toBe('- 负责问卷与访谈，围绕入口难以发现这一研究问题，形成研究结论。')
  })

  test('same value is no-op, old revision cannot overwrite newer state', () => {
    const document = fixture()
    const fill = command(document, 'fill', '入口难以发现')
    const next = success(applyCompletionCommand(document, fill))
    expect(applyCompletionCommand(next, fill)).toMatchObject({ok: false, issues: [{code: 'COMPLETION_REVISION_CONFLICT'}]})
    expect(applyCompletionCommand(next, command(next, 'fill', '入口难以发现'))).toMatchObject({ok: true, changed: false})
  })

  test('blank input clears state and pasted lines normalize visibly', () => {
    expect(normalizeGapValue('  新用户\r\n 找不到入口\u200b ')).toBe('新用户  找不到入口')
    expect(normalizeGapValue('第一行\u2028第二行\u2029第三行')).toBe('第一行 第二行 第三行')
    const document = fixture()
    const filled = success(applyCompletionCommand(document, command(document, 'fill', '第一行\n第二行')))
    expect(serializeDraft(filled)).toContain('第一行 第二行')
    const cleared = success(applyCompletionCommand(filled, command(filled, 'fill', '\u200b \n ')))
    expect((cleared.blocks[0].segments[1] as ResumeGapSegment).fill).toEqual({state: 'empty'})
  })

  test('placeholder instructions cannot be accepted as filled facts', () => {
    const document = fixture()
    const gap = document.blocks[0].segments[1] as ResumeGapSegment
    for (const value of [gap.instruction, renderCompletionPlaceholder(gap), '〔待补 1：研究问题〕']) {
      expect(applyCompletionCommand(document, command(document, 'fill', value)).ok).toBe(false)
    }
  })

  test('Markdown characters are escaped only in local input', () => {
    const document = fixture()
    const next = success(applyCompletionCommand(document, command(document, 'fill', '**问题** [链接] <标签>')))
    expect(serializeDraft(next)).toContain('\\*\\*问题\\*\\* \\[链接\\] \\<标签\\>')
    expect((next.blocks[0].segments[1] as ResumeGapSegment).fill).toMatchObject({value: '**问题** [链接] <标签>'})
  })

  test('omit provides one revision-bound undo and does not leave prior values', () => {
    const document = fixture()
    const result = applyCompletionCommand(document, command(document, 'omit'))
    if (!result.ok || !result.undo) throw new Error('missing undo')
    expect(serializeDraft(result.document)).toBe(serializeWithoutAllGapClauses(document))
    expect((result.document.blocks[0].segments[1] as ResumeGapSegment).fill).toEqual({state: 'omitted'})
    const next = success(applyCompletionCommand(result.document, result.undo))
    expect(serializeDraft(next)).toBe(serializeDraft(document))
    expect(next.revision).toBe(2)
  })

  test('same hint in two blocks never changes both gaps', () => {
    const document = fixture()
    const extra = fixture().blocks[0]
    extra.blockId = 'block-2'
    extra.segments = extra.segments.map(segment => segment.kind === 'text' ? {...segment, segmentId: `${segment.segmentId}-2`} : {...segment, gapId: 'gap-2'})
    document.blocks.push(extra)
    const next = success(applyCompletionCommand(refresh(document), command(document, 'fill', '实际问题')))
    expect((next.blocks[1].segments[1] as ResumeGapSegment).fill.state).toBe('empty')
  })
})

describe('omission protection and export', () => {
  test('export drops complete optional clause and never mutates the draft', () => {
    const document = fixture()
    const before = JSON.stringify(document)
    expect(prepareResumeExport(document)).toEqual({ok: true, markdown: '- 负责问卷与访谈，形成研究结论。', omittedCount: 1})
    expect(JSON.stringify(document)).toBe(before)
  })

  test('filled values export and omitted nodes are not counted twice', () => {
    const document = fixture()
    const filled = success(applyCompletionCommand(document, command(document, 'fill', '真实问题')))
    expect(prepareResumeExport(filled)).toEqual({ok: true, markdown: serializeDraft(filled), omittedCount: 0})
    const omitted = success(applyCompletionCommand(filled, command(filled, 'omit')))
    expect(prepareResumeExport(omitted)).toMatchObject({ok: true, omittedCount: 0})
  })

  test('metric empty export retains baseline and removes comparison fragment', () => {
    expect(prepareResumeExport(fixture('metric_detail'))).toEqual({ok: true, markdown: '- 完成率基线为63.02%。', omittedCount: 1})
  })

  test('same number for another object cannot satisfy a metric anchor', () => {
    const document = fixture('metric_detail')
    const before = document.blocks[0].segments[0]
    if (before.kind === 'text') before.markdown = '留存率基线为63.02%'
    const next = refresh(document)
    expect(prepareResumeExport(next)).toMatchObject({ok: false, issues: [{code: 'COMPLETION_RETAINED_FACT_MISSING'}]})
  })

  test('filled metric with missing anchor can export but cannot be silently cleared', () => {
    let document = fixture('metric_detail')
    document = success(applyCompletionCommand(document, command(document, 'fill', '88%')))
    const before = document.blocks[0].segments[0]
    if (before.kind === 'text') before.markdown = '参与项目'
    document = refresh(document)
    expect(prepareResumeExport(document).ok).toBe(true)
    expect(applyCompletionCommand(document, command(document, 'clear')).ok).toBe(false)
    expect(applyCompletionCommand(document, command(document, 'omit')).ok).toBe(false)
  })

  test('malformed known boundary blocks export', () => {
    const document = fixture()
    const before = document.blocks[0].segments[0]
    if (before.kind === 'text') before.markdown = '负责'
    expect(validateOmissionSafety(refresh(document)).length).toBeGreaterThan(0)
  })

  test('raw pending text is repairable but cannot leak into downloaded file', () => {
    const document = createPlainCompletionDocument('- 参与项目【待完善：已损坏】。')
    expect(validateCompletionDocument(document).ok).toBe(true)
    expect(prepareResumeExport(document).ok).toBe(false)
    expect(prepareResumeExport(createPlainCompletionDocument('- 项目尚未上线。')).ok).toBe(true)
  })
})

describe('whole row edits', () => {
  test('unchanged row is a true no-op', () => {
    const document = fixture()
    const session = beginRowEdit(document, 'block-1')!
    expect(reconcileRowEdit(document, session, session.draft)).toEqual({ok: true, document, changed: false})
  })

  test('editing neighboring text preserves gap identity and local fill capability', () => {
    const document = fixture()
    const session = beginRowEdit(document, 'block-1')!
    const next = success(reconcileRowEdit(document, session, session.draft.replace('形成研究结论', '整理研究记录')))
    expect((next.blocks[0].segments[1] as ResumeGapSegment).gapId).toBe('gap-1')
    expect(applyCompletionCommand(next, command(next, 'fill', '真实问题')).ok).toBe(true)
  })

  test('unchanged filled clause remains locally editable after nearby edits', () => {
    const document = success(applyCompletionCommand(fixture(), command(fixture(), 'fill', '入口难以发现')))
    const session = beginRowEdit(document, 'block-1')!
    const next = success(reconcileRowEdit(document, session, session.draft.replace('形成研究结论', '整理研究记录')))
    expect(next.blocks[0].segments.some(segment => segment.kind === 'optional_gap_clause' && segment.gapId === 'gap-1' && segment.fill.state === 'filled')).toBe(true)
  })

  test('replace pending token with actual text becomes ordinary user text', () => {
    const document = fixture()
    const session = beginRowEdit(document, 'block-1')!
    const next = success(reconcileRowEdit(document, session, session.draft.replace(session.tokens[0].token, '用户难以找到入口')))
    expect(next.blocks[0].segments.every(segment => segment.kind === 'text')).toBe(true)
    expect(prepareResumeExport(next)).toMatchObject({ok: true, markdown: '- 负责问卷与访谈，围绕用户难以找到入口这一研究问题，形成研究结论。'})
  })

  test('suffix-free template replacement retains its prefix and actual value', () => {
    const document = fixture('design_deliverable')
    const session = beginRowEdit(document, 'block-1')!
    const next = success(reconcileRowEdit(document, session, session.draft.replace(session.tokens[0].token, '页面原型')))
    expect(serializeDraft(next)).toContain('，交付设计产物页面原型，')
  })

  test('deleting just a pending token removes the complete optional clause', () => {
    for (const template of ['research_problem', 'design_deliverable'] as const) {
      const document = fixture(template)
      const session = beginRowEdit(document, 'block-1')!
      for (const value of ['', '   ']) {
        const next = success(reconcileRowEdit(document, session, session.draft.replace(session.tokens[0].token, value)))
        expect(serializeDraft(next)).toBe(serializeWithoutAllGapClauses(document))
      }
    }
  })

  test('duplicate or damaged token rejects the changed row', () => {
    const document = fixture()
    const session = beginRowEdit(document, 'block-1')!
    for (const draft of [session.draft + session.tokens[0].token, session.draft.replace('这一研究问题', '这个项目'),
      session.draft.replace('〔', ''), session.draft.replace('〕', ''), session.draft.replace('〔', '').replace('〕', '')]) {
      expect(reconcileRowEdit(document, session, draft).ok).toBe(false)
    }
  })

  test('newlines preserve the first row identity and allocate unique nodes', () => {
    const document = fixture()
    const session = beginRowEdit(document, 'block-1')!
    const next = success(reconcileRowEdit(document, session, session.draft + '\n- 新增实际工作。'))
    expect(next.blocks).toHaveLength(2)
    expect(next.blocks[0].blockId).toBe('block-1')
    expect(validateCompletionDocument(next).ok).toBe(true)
  })

  test('deleting baseline while metric remains pending cannot silently lose facts', () => {
    const document = fixture('metric_detail')
    const session = beginRowEdit(document, 'block-1')!
    expect(reconcileRowEdit(document, session, session.draft.replace('完成率基线为63.02%', '参与项目')).ok).toBe(false)
  })

  test('deleting baseline and only token together cannot trigger automatic fact loss', () => {
    const document = fixture('metric_detail')
    const session = beginRowEdit(document, 'block-1')!
    const draft = session.draft.replace('完成率基线为63.02%', '参与项目').replace(session.tokens[0].token, '')
    expect(reconcileRowEdit(document, session, draft)).toMatchObject({ok: false, issues: [{code: 'COMPLETION_RETAINED_FACT_MISSING'}]})
  })

  test('two blanks on one row keep their separate IDs after editing', () => {
    const document = fixture()
    const middle = document.blocks[0].segments[2]
    if (middle.kind === 'text') middle.markdown = '，分析结果'
    const second = {...(fixture('design_deliverable').blocks[0].segments[1] as ResumeGapSegment), gapId: 'gap-2'}
    document.blocks[0].segments.push(second, {kind: 'text', segmentId: 'text-3', markdown: '。', origin: 'generated'})
    const valid = refresh(document)
    const session = beginRowEdit(valid, 'block-1')!
    const next = success(reconcileRowEdit(valid, session, session.draft.replace('分析结果', '整理结果')))
    expect(next.blocks[0].segments.filter(segment => segment.kind === 'optional_gap_clause').map(segment => segment.gapId)).toEqual(['gap-1', 'gap-2'])
    expect(prepareResumeExport(next)).toMatchObject({ok: true, markdown: '- 负责问卷与访谈，整理结果。', omittedCount: 2})
  })

  test('a complete explicit rewrite can remove obsolete metric and anchor', () => {
    const document = fixture('metric_detail')
    const session = beginRowEdit(document, 'block-1')!
    const next = success(reconcileRowEdit(document, session, '- 参与项目并完成实际交付。'))
    expect(prepareResumeExport(next)).toMatchObject({ok: true, markdown: '- 参与项目并完成实际交付。'})
  })
})

describe('legacy and recovery', () => {
  test('known static legacy templates migrate losslessly', () => {
    for (const template of ['problem', 'research_problem', 'method', 'role_detail', 'project_name', 'design_deliverable'] as const) {
      const original = fixture(template)
      const result = migrateLegacyCompletion(serializeDraft(original))
      expect(result.status).toBe('ready')
      expect(result.migrated).toBe(true)
      expect(serializeDraft(result.document)).toBe(serializeDraft(original))
      expect(prepareResumeExport(result.document).ok).toBe(true)
    }
  })

  test('legacy category references remain choices rather than facts', () => {
    const document = fixture('design_deliverable')
    const gap = document.blocks[0].segments[1] as ResumeGapSegment
    gap.candidates = ['需求文档', '页面原型', '交互流程'].map(text => ({text, kind: 'category_example'}))
    const result = migrateLegacyCompletion(serializeDraft(refresh(document)))
    expect(result.status).toBe('ready')
    expect((result.document.blocks[0].segments[1] as ResumeGapSegment).candidates).toHaveLength(3)
    expect(prepareResumeExport(result.document)).toMatchObject({ok: true, markdown: '- 负责问卷与访谈，形成研究结论。'})
  })

  test('unprovable old dynamic metric does not guess deletion boundaries', () => {
    const text = serializeDraft(fixture('metric_detail'))
    const result = migrateLegacyCompletion(text)
    expect(result.status).toBe('repair_required')
    expect(serializeDraft(result.document)).toBe(text)
    expect(prepareResumeExport(result.document).ok).toBe(false)
  })

  test('mismatched metadata never overwrites actual Markdown', () => {
    const result = normalizeCompletionDocument('- 用户已改写正文。', fixture())
    expect(result.status).toBe('repair_required')
    expect(serializeDraft(result.document)).toBe('- 用户已改写正文。')
  })

  test('damaged marker can be repaired one row at a time', () => {
    const result = migrateLegacyCompletion('- 第一行【待完善：坏标记】。\n- 第二行【待完善：坏标记】。')
    expect(result.status).toBe('repair_required')
    const first = beginRowEdit(result.document, result.document.blocks[0].blockId)!
    const next = success(reconcileRowEdit(result.document, first, '- 第一行已填完整。'))
    expect(normalizeCompletionDocument(serializeDraft(next), next).status).toBe('repair_required')
    const second = beginRowEdit(next, next.blocks[1].blockId)!
    const finished = success(reconcileRowEdit(next, second, '- 第二行已填完整。'))
    expect(normalizeCompletionDocument(serializeDraft(finished), finished).status).toBe('ready')
    expect(prepareResumeExport(finished).ok).toBe(true)
  })

  test('legacy templates with damaged boundaries stay plain repair text so other repaired rows can save', () => {
    const original = serializeDraft(fixture()).replace('负责问卷与访谈', '负责')
    const text = `${original}\n${original}`
    const migrated = migrateLegacyCompletion(text)
    expect(migrated.status).toBe('repair_required')
    expect(serializeDraft(migrated.document)).toBe(text)
    expect(validateOmissionSafety(migrated.document)).toEqual([])
    expect(migrated.document.blocks.every(block => block.segments.every(segment => segment.kind === 'text'))).toBe(true)
    const session = beginRowEdit(migrated.document, migrated.document.blocks[0].blockId)!
    const repaired = success(reconcileRowEdit(migrated.document, session, '- 第一行已写成完整经历。'))
    expect(validateCompletionDocument(repaired).ok).toBe(true)
    expect(validateOmissionSafety(repaired)).toEqual([])
    expect(normalizeCompletionDocument(serializeDraft(repaired), repaired).status).toBe('repair_required')
    expect(prepareResumeExport(repaired).ok).toBe(false)
    const second = beginRowEdit(repaired, repaired.blocks[1].blockId)!
    const finished = success(reconcileRowEdit(repaired, second, '- 第二行已写成完整经历。'))
    expect(prepareResumeExport(finished).ok).toBe(true)
  })

  test('ordinary text with pending wording is not mistaken for a placeholder', () => {
    expect(migrateLegacyCompletion('- 跟进待完善的流程规范。').status).toBe('ready')
  })

  test('lost opening bracket in old controlled guidance is still repair-required', () => {
    const text = serializeDraft(fixture()).replace('【', '')
    const result = migrateLegacyCompletion(text)
    expect(result.status).toBe('repair_required')
    expect(serializeDraft(result.document)).toBe(text)
    expect(prepareResumeExport(result.document).ok).toBe(false)
  })

  test('repeated static legacy placeholders get distinct stable IDs', () => {
    const text = `${serializeDraft(fixture())}\n${serializeDraft(fixture())}`
    const first = migrateLegacyCompletion(text), second = migrateLegacyCompletion(text)
    expect(first.document).toEqual(second.document)
    const ids = first.document.blocks.flatMap(block => block.segments.flatMap(segment => segment.kind === 'optional_gap_clause' ? [segment.gapId] : []))
    expect(new Set(ids).size).toBe(2)
  })
})
