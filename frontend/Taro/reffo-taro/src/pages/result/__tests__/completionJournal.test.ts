import {expect, test} from '@jest/globals'
import type {OptimizedResume} from '@/types'
import {acknowledgeCompletionEdits, appendCompletionEdits, rebaseCompletionEdits} from '../model/completionJournal'
import {applyCompletionCommand, beginRowEdit, createCompletionDocument, reconcileRowEdit, replayCompletionOperation, serializeDraft} from '@/shared/resume-completion'
import {completionFixture, completionResult} from './completionFixture'

function v2Document() {
  const legacy = completionFixture()
  return createCompletionDocument({documentId: legacy.documentId, revision: legacy.revision, schemaVersion: 'resume-completion-v2',
    blocks: legacy.blocks.map(block => ({...block, segments: block.segments.map(segment => segment.kind === 'optional_gap_clause'
      ? {...segment, detailId: 'detail-deliverable'} : segment)}))})
}

function edit(document: ReturnType<typeof v2Document>, type: 'fill' | 'clear', value?: string) {
  const result = applyCompletionCommand(document, {documentId: document.documentId, baseRevision: document.revision,
    gapId: 'deliverable', type, ...(value ? {value} : {})})
  if (!result.ok || !result.operation) throw new Error('fixture edit failed')
  return result
}

function optimized(document: ReturnType<typeof v2Document>, completion_edit?: OptimizedResume['completion_edit']): OptimizedResume {
  return {...completionResult(document).optimized, ...(completion_edit ? {completion_edit} : {})}
}

test('v2 appends only replayable operations and rejects a document that does not match its operation', () => {
  const base = v2Document()
  const first = edit(base, 'fill', '页面原型')
  const firstJournal = appendCompletionEdits(optimized(base), first.document, first.operation)
  expect(firstJournal).toEqual({documentId: base.documentId, baseRevision: 0, operations: [first.operation]})

  const second = edit(first.document, 'clear')
  const nextJournal = appendCompletionEdits(optimized(first.document, firstJournal), second.document, second.operation)
  expect(nextJournal?.operations).toEqual([first.operation, second.operation])
  expect(nextJournal?.baseRevision).toBe(0)

  const other = edit(base, 'fill', '交互流程')
  expect(() => appendCompletionEdits(optimized(base), other.document, first.operation)).toThrow('填写操作与简历不一致')
  expect(serializeDraft(second.document)).toContain('待完善')
})

test('history acknowledgement removes only its submitted prefix and rebases newer operations', () => {
  const base = v2Document()
  const first = edit(base, 'fill', '页面原型')
  const firstJournal = appendCompletionEdits(optimized(base), first.document, first.operation)!
  const second = edit(first.document, 'clear')
  const fullJournal = appendCompletionEdits(optimized(first.document, firstJournal), second.document, second.operation)!

  const current = optimized(second.document, fullJournal)
  const submitted = optimized(first.document, firstJournal)
  const rebased = acknowledgeCompletionEdits(current, submitted)
  expect(rebased.completion_edit).toEqual({documentId: base.documentId, baseRevision: 1, operations: [second.operation]})

  const fullyAcknowledged = acknowledgeCompletionEdits(optimized(first.document, firstJournal), submitted)
  expect(fullyAcknowledged).not.toHaveProperty('completion_edit')
})

test('does not acknowledge an unrelated or reordered operation prefix', () => {
  const base = v2Document()
  const first = edit(base, 'fill', '页面原型')
  const journal = appendCompletionEdits(optimized(base), first.document, first.operation)!
  const unrelated = edit(first.document, 'clear')
  const submitted = optimized(first.document, {...journal, operations: [unrelated.operation!]})
  expect(acknowledgeCompletionEdits(optimized(first.document, journal), submitted).completion_edit).toEqual(journal)
})

test('choosing local v2 fields produces operations based on the current server revision', () => {
  const base = v2Document()
  const local = edit(base, 'fill', '页面原型')
  const remote = edit(base, 'fill', '交互流程')
  const localState = optimized(local.document, appendCompletionEdits(optimized(base), local.document, local.operation))
  const rebased = rebaseCompletionEdits(base, optimized(remote.document), localState)
  expect(rebased.completion_edit?.baseRevision).toBe(remote.document.revision)
  expect(rebased.completion_document?.revision).toBe(2)
  expect(rebased.optimized_resume).toContain('页面原型')
  const replayed = replayCompletionOperation(remote.document, rebased.completion_edit!.operations[0])
  expect(replayed).toMatchObject({ok: true, document: rebased.completion_document})
  expect(rebaseCompletionEdits(base, optimized(local.document), localState).completion_edit).toBeUndefined()
})

test('a conflicting row edit or forged local journal remains unresolved', () => {
  const base = v2Document()
  const local = edit(base, 'fill', '页面原型')
  const localState = optimized(local.document, appendCompletionEdits(optimized(base), local.document, local.operation))
  const row = beginRowEdit(base, 'bullet')!
  const remote = reconcileRowEdit(base, row, row.draft.replace('参与需求梳理', '参与需求评审'))
  if (!remote.ok) throw new Error('fixture failed')
  expect(() => rebaseCompletionEdits(base, optimized(remote.document), localState)).toThrow('无法安全合并')
  const forged = {...localState, completion_edit: {...localState.completion_edit!, operations: []}}
  expect(() => rebaseCompletionEdits(base, optimized(base), forged)).toThrow('无法安全合并')
})

test('verified local restore operations preserve unrelated server changes', () => {
  const original = v2Document()
  const base = createCompletionDocument({...original, blocks: [...original.blocks, {blockId: 'other', kind: 'paragraph', prefix: '',
    segments: [{kind: 'text', segmentId: 'other-text', markdown: '任职信息', origin: 'generated'}]}]})
  const local = edit(base, 'fill', '页面原型')
  const restore = {kind: 'restore' as const, documentId: base.documentId, baseRevision: local.document.revision,
    previousDocument: base, operation: local.operation! as Extract<NonNullable<typeof local.operation>, {kind: 'gap'}>}
  const restored = replayCompletionOperation(local.document, restore)
  if (!restored.ok) throw new Error('fixture failed')
  const remote = reconcileRowEdit(base, beginRowEdit(base, 'other')!, '已更新任职信息')
  if (!remote.ok) throw new Error('fixture failed')
  const rebased = rebaseCompletionEdits(base, optimized(remote.document), optimized(restored.document, {
    documentId: base.documentId, baseRevision: 0, operations: [local.operation!, restore],
  }))
  expect(rebased.optimized_resume).toContain('已更新任职信息')
  expect(rebased.optimized_resume).toContain('待完善')
  let replayed = remote.document
  for (const operation of rebased.completion_edit!.operations) {
    const result = replayCompletionOperation(replayed, operation)
    if (!result.ok) throw new Error('replay failed')
    replayed = result.document
  }
  expect(replayed).toEqual(rebased.completion_document)
})
