import {describe, expect, test} from 'bun:test'
import {applyCompletionCommand, beginRowEdit, collectGaps, COMPLETION_TEMPLATES, createCompletionDocument,
  findClaim, findGap, normalizeCompletionDocument, prepareResumeExport, reconcileRowEdit, replayCompletionOperation,
  serializeDraft, serializeWithoutAllGapClauses, validateCompletionDocument, validateOmissionSafety,
  type CompletionEditResult, type ResumeCompletionDocument, type ResumeDependentClaim, type ResumeGapSegment,
  type ResumeRequiredDetailGap} from './resume-completion'

function ok(result: CompletionEditResult) {
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result
}

function fixture(readiness: ResumeDependentClaim['readiness'] = 'metadata_missing') {
  const templates = ['metric_definition', 'metric_period', 'metric_population'] as const
  const fields = templates.map((template, index): ResumeRequiredDetailGap => ({kind: 'required_detail_gap',
    gapId: `g${index}`, detailId: `d${index}`, template, ...COMPLETION_TEMPLATES[template], candidates: [], fill: {state: 'empty'}}))
  const claim: ResumeDependentClaim = {kind: 'dependent_claim', claimId: 'claim', sourceEvidenceIds: ['e1'],
    sourceSpans: [{sourceBlockId: 'b1', start: 0, end: 15}], readiness, qualifiers: ['原材料记录'],
    parts: [{kind: 'text', segmentId: 'ct1', markdown: '，原材料记录辅导有效率95%', origin: 'generated'}, ...fields,
      {kind: 'text', segmentId: 'ct2', markdown: '。', origin: 'generated'}], requiredGapIds: fields.map(field => field.gapId), fillPolicy: 'all_required'}
  return createCompletionDocument({schemaVersion: 'resume-completion-v2', documentId: 'v2', blocks: [
    {blockId: 'b', kind: 'bullet', prefix: '- ', segments: [{kind: 'text', segmentId: 't', markdown: '设计四类能力', origin: 'generated'}, claim]},
  ]})
}

function fill(document: ResumeCompletionDocument, gapId: string, value: string) {
  return ok(applyCompletionCommand(document, {documentId: document.documentId, baseRevision: document.revision, gapId, type: 'fill', value})).document
}

function filled(readiness: ResumeDependentClaim['readiness'] = 'metadata_missing') {
  let document = fixture(readiness)
  for (const [index, value] of ['店长评价通过', '2026年8月', '参与试点门店'].entries()) document = fill(document, `g${index}`, value)
  return document
}

describe('completion v2 dependency contract', () => {
  test('required fields are traversed without business count caps', () => {
    const document = fixture()
    expect(collectGaps(document)).toHaveLength(3)
    expect(validateCompletionDocument(document).ok).toBe(true)
    expect(findGap(document, 'g1')?.kind).toBe('required_detail_gap')
    expect(serializeWithoutAllGapClauses(document)).toBe('- 设计四类能力')
  })

  test('more than three optional gaps in the same experience remain valid', () => {
    const document = fixture()
    document.blocks[0].segments = [{kind: 'text', segmentId: 'start', markdown: '完成设计', origin: 'generated'}]
    for (let i = 0; i < 7; i++) {
      const gap: ResumeGapSegment = {kind: 'optional_gap_clause', gapId: `o${i}`, detailId: `od${i}`,
        template: 'design_deliverable', ...COMPLETION_TEMPLATES.design_deliverable, candidates: [], fill: {state: 'empty'}, retainedFacts: []}
      document.blocks[0].segments.push(gap, {kind: 'text', segmentId: `tail${i}`, markdown: i === 6 ? '。' : '，继续参与调研', origin: 'generated'})
    }
    const sealed = createCompletionDocument({...document})
    expect(validateCompletionDocument(sealed).ok).toBe(true)
    expect(collectGaps(sealed)).toHaveLength(7)
    expect(prepareResumeExport(sealed).ok).toBe(true)
  })

  test('empty and partial claim never exports its dependent number', () => {
    const empty = fixture()
    const partial = fill(empty, 'g0', '店长评价通过')
    for (const document of [empty, partial]) {
      expect(prepareResumeExport(document)).toEqual({ok: true, markdown: '- 设计四类能力', omittedCount: 0, omittedClaimCount: 1})
      expect(serializeDraft(document)).toContain('95%')
    }
  })

  test('required placeholders explain whole-result omission inside the blank', () => {
    const draft = serializeDraft(fixture())
    expect(draft).toContain('必要信息未填齐时，下载省略整条关联结果')
    expect(draft).not.toContain('无法确认时删去')
  })

  test('all required user inputs allow export without granting source fact credit', () => {
    const document = filled()
    expect(prepareResumeExport(document)).toMatchObject({ok: true, omittedClaimCount: 0})
    const exported = prepareResumeExport(document)
    if (exported.ok) expect(exported.markdown).toContain('原材料记录辅导有效率95%')
    expect(serializeWithoutAllGapClauses(document)).toBe('- 设计四类能力')
    expect(collectGaps(document).every(gap => gap.fill.state === 'filled' && gap.fill.origin === 'user')).toBe(true)
  })

  test.each(['conflicted', 'context_incomplete'] as const)('filling all details does not unlock %s', state => {
    expect(prepareResumeExport(filled(state))).toMatchObject({ok: true, markdown: '- 设计四类能力', omittedClaimCount: 1})
  })

  test('clear, omit and undo preserve all other fields and result dependence', () => {
    const document = filled()
    const clear = ok(applyCompletionCommand(document, {documentId: 'v2', baseRevision: document.revision, gapId: 'g1', type: 'clear'})).document
    expect(findGap(clear, 'g0')?.fill).toEqual(findGap(document, 'g0')?.fill)
    expect(prepareResumeExport(clear)).toMatchObject({ok: true, omittedClaimCount: 1})
    const omitted = ok(applyCompletionCommand(document, {documentId: 'v2', baseRevision: document.revision, gapId: 'g1', type: 'omit'}))
    expect(serializeDraft(omitted.document)).toContain('待完善')
    expect(prepareResumeExport(omitted.document)).toMatchObject({ok: true, omittedClaimCount: 1})
    expect(prepareResumeExport(ok(applyCompletionCommand(omitted.document, omitted.undo!)).document)).toMatchObject({ok: true, omittedClaimCount: 0})
  })

  test('invalid field references and nested groups are rejected', () => {
    for (const change of [(claim: ResumeDependentClaim) => {claim.requiredGapIds.pop()},
      (claim: ResumeDependentClaim) => {claim.requiredGapIds[0] = 'unknown'},
      (claim: ResumeDependentClaim) => {claim.parts.push(claim as unknown as ResumeRequiredDetailGap)},
      (claim: ResumeDependentClaim) => {claim.qualifiers.push('未经来源支持的限定')}]) {
      const document = fixture(); change(findClaim(document, 'claim')!)
      // Avoid serializing the intentionally cyclic structure before validation.
      expect(validateCompletionDocument(document).ok).toBe(false)
    }
  })

  test('duplicate result outside its group prevents omission/export leakage', () => {
    const document = fixture()
    document.blocks[0].segments.unshift({kind: 'text', segmentId: 'leak', markdown: '原材料记录辅导有效率95%，', origin: 'generated'})
    const next = createCompletionDocument({...document})
    expect(validateOmissionSafety(next)).toContainEqual(expect.objectContaining({code: 'COMPLETION_DEPENDENT_FACT_LEAK'}))
    expect(prepareResumeExport(next).ok).toBe(false)
  })

  test('empty dependent-only bullet is removed without mutating the draft', () => {
    const document = fixture()
    document.blocks[0].segments.shift()
    const next = createCompletionDocument({...document})
    const snapshot = JSON.stringify(next)
    expect(prepareResumeExport(next)).toMatchObject({ok: true, markdown: '', omittedClaimCount: 1})
    expect(serializeWithoutAllGapClauses(next)).toBe('')
    expect(JSON.stringify(next)).toBe(snapshot)
  })

  test('unknown and damaged structured documents are display-only, never plain migration', () => {
    for (const value of [{...fixture(), schemaVersion: 'resume-completion-v99'}, {...fixture(), markdownFingerprint: 'broken'}]) {
      const loaded = normalizeCompletionDocument(serializeDraft(fixture()), value)
      expect(loaded).toMatchObject({blocked: true, migrated: false, status: 'repair_required'})
      expect(loaded.rawDocument).toEqual(value)
      expect(serializeDraft(loaded.document)).toBe(serializeDraft(fixture()))
      expect(beginRowEdit(loaded.document, loaded.document.blocks[0].blockId)).toBeUndefined()
      expect(prepareResumeExport(loaded.document).ok).toBe(false)
      expect(validateCompletionDocument(loaded.document).ok).toBe(false)
    }
  })
})

describe('completion v2 row edits and replay', () => {
  test('untrusted malformed replay payloads return errors without throwing', () => {
    const document = fixture()
    for (const operation of [null, {}, {kind: 'gap'}, {kind: 'gap', command: null}, {kind: 'gap', command: {value: 5}},
      {kind: 'row'}, {kind: 'row', documentId: 'v2', baseRevision: 0, blockId: 'b'},
      {kind: 'row', documentId: 'v2', baseRevision: 0, blockId: 'b', draft: {}},
      {kind: 'restore', documentId: 'v2', baseRevision: 0},
      {kind: 'restore', documentId: 'v2', baseRevision: 0, operation: {kind: 'gap'}},
      {kind: 'restore', documentId: 'v2', baseRevision: 0, previousDocument: document, operation: {kind: 'restore'}}]) {
      expect(() => replayCompletionOperation(document, operation as Parameters<typeof replayCompletionOperation>[1])).not.toThrow()
      expect(replayCompletionOperation(document, operation as Parameters<typeof replayCompletionOperation>[1]).ok).toBe(false)
    }
  })

  test('mixed ordinary gaps and dependent fields preserve stable token identities', () => {
    const document = fixture()
    const before = document.blocks[0].segments[0]
    if (before.kind === 'text') before.markdown += '。'
    const firstClaimPart = findClaim(document, 'claim')!.parts[0]
    if (firstClaimPart.kind === 'text') firstClaimPart.markdown = firstClaimPart.markdown.slice(1)
    const extra: ResumeGapSegment = {kind: 'optional_gap_clause', gapId: 'ordinary', detailId: 'ordinary-detail',
      template: 'design_deliverable', ...COMPLETION_TEMPLATES.design_deliverable, candidates: [], fill: {state: 'empty'}, retainedFacts: []}
    document.blocks[0].segments.push({kind: 'text', segmentId: 'afterClaim', markdown: '继续组织调研', origin: 'generated'}, extra,
      {kind: 'text', segmentId: 'last', markdown: '。', origin: 'generated'})
    const original = createCompletionDocument({...document})
    const row = beginRowEdit(original, 'b')!
    const changed = ok(reconcileRowEdit(original, row, row.draft.replace('继续组织调研', '继续参与调研')))
    expect(collectGaps(changed.document).map(gap => gap.gapId)).toEqual(['g0', 'g1', 'g2', 'ordinary'])
    expect(ok(replayCompletionOperation(original, changed.operation!)).document).toEqual(changed.document)
  })

  test('filled field content containing markdown survives neighboring row edits once', () => {
    let document = fill(fixture(), 'g0', '**有效** [标准]')
    document = fill(document, 'g1', '2026年8月')
    document = fill(document, 'g2', '试点门店')
    const row = beginRowEdit(document, 'b')!
    const changed = ok(reconcileRowEdit(document, row, row.draft.replace('设计四类能力', '设计四类辅导能力')))
    expect(findGap(changed.document, 'g0')?.fill).toEqual(findGap(document, 'g0')?.fill)
    expect(serializeDraft(changed.document)).not.toContain('\\\\*')
  })

  test('editing surrounding text preserves the group and required IDs', () => {
    const document = fixture(), row = beginRowEdit(document, 'b')!
    const next = ok(reconcileRowEdit(document, row, row.draft.replace('设计四类能力', '设计四类辅导能力')))
    expect(findClaim(next.document, 'claim')).toEqual(findClaim(document, 'claim'))
    expect(collectGaps(next.document).map(gap => gap.gapId)).toEqual(['g0', 'g1', 'g2'])
    expect(ok(replayCompletionOperation(document, next.operation!)).document).toEqual(next.document)
  })

  test('replacing one required token fills only its field and preserves dependency', () => {
    const document = fixture(), row = beginRowEdit(document, 'b')!
    const next = ok(reconcileRowEdit(document, row, row.draft.replace(row.tokens[0].token, '店长评价通过')))
    expect(findGap(next.document, 'g0')?.fill).toEqual({state: 'filled', value: '店长评价通过', origin: 'user'})
    expect(findGap(next.document, 'g1')?.fill).toEqual({state: 'empty'})
    expect(prepareResumeExport(next.document)).toMatchObject({ok: true, omittedClaimCount: 1})
  })

  test('deleting only a required token never turns the claim into plain text', () => {
    const document = fixture(), row = beginRowEdit(document, 'b')!
    const next = ok(reconcileRowEdit(document, row, row.draft.replace(row.tokens[0].token, ''))).document
    expect(findClaim(next, 'claim')).toBeDefined()
    expect(findGap(next, 'g0')?.fill).toEqual({state: 'empty'})
    expect(prepareResumeExport(next)).toMatchObject({ok: true, markdown: '- 设计四类能力', omittedClaimCount: 1})
  })

  test('deleting prompts and keeping the original number cannot bypass dependence', () => {
    const document = fixture(), row = beginRowEdit(document, 'b')!
    expect(reconcileRowEdit(document, row, '- 设计四类能力，原材料记录辅导有效率95%。').ok).toBe(false)
    expect(reconcileRowEdit(document, row, '- 设计四类能力，有效率95%。').ok).toBe(false)
  })

  test('a complete replacement records user authorship and gives no source credit', () => {
    const document = fixture(), row = beginRowEdit(document, 'b')!
    const next = ok(reconcileRowEdit(document, row, '- 完成访谈与交互方案设计。'))
    expect(findClaim(next.document, 'claim')).toBeUndefined()
    expect(next.document.blocks[0].segments).toContainEqual(expect.objectContaining({origin: 'user', replacedClaimIds: ['claim']}))
    expect(serializeWithoutAllGapClauses(next.document)).toBe('')
    expect(ok(replayCompletionOperation(document, next.operation!)).document).toEqual(next.document)
  })

  test('duplicate dependent groups and ambiguous partial modifications are rejected', () => {
    const document = fixture(), row = beginRowEdit(document, 'b')!
    expect(reconcileRowEdit(document, row, row.draft + row.draft).ok).toBe(false)
    expect(reconcileRowEdit(document, row, row.draft.replace('95%', '96%')).ok).toBe(false)
  })

  test('restore requires a verified inverse edit, arbitrary snapshots cannot overwrite', () => {
    const document = fixture()
    const change = ok(applyCompletionCommand(document, {documentId: 'v2', baseRevision: 0, gapId: 'g0', type: 'fill', value: '实际定义'}))
    const operation = {kind: 'restore' as const, documentId: 'v2', baseRevision: 1, previousDocument: document,
      operation: change.operation! as {kind: 'gap'; command: Parameters<typeof applyCompletionCommand>[1]}}
    const restored = ok(replayCompletionOperation(change.document, operation)).document
    expect(findGap(restored, 'g0')?.fill).toEqual({state: 'empty'})
    expect(restored.revision).toBe(2)
    const forged = fixture(); forged.blocks[0].segments[0] = {kind: 'text', segmentId: 't', markdown: '虚构成果', origin: 'generated'}
    expect(replayCompletionOperation(change.document, {...operation, previousDocument: createCompletionDocument({...forged})}).ok).toBe(false)
  })
})
