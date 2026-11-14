import {findGap, replayCompletionOperation, serializeDraft, validateCompletionDocument, type CompletionEditJournal, type CompletionForwardOperation, type CompletionOperation, type ResumeCompletionDocument} from '@/shared/resume-completion'
import type {OptimizedResume} from '@/types'

export function appendCompletionEdits(
  current: OptimizedResume,
  next: ResumeCompletionDocument,
  operation?: CompletionOperation | CompletionOperation[],
): CompletionEditJournal | undefined {
  if (next.schemaVersion === 'resume-completion-v1') return current.completion_edit
  const base = current.completion_document
  if (!base || base.documentId !== next.documentId) throw new Error('原始填写结构不可用，请重新打开简历')
  if (JSON.stringify(base) === JSON.stringify(next)) return current.completion_edit
  const operations = Array.isArray(operation) ? operation : operation ? [operation] : []
  if (!operations.length) throw new Error('缺少本次填写操作，请重新打开编辑后保存')
  let replayed = base
  for (const item of operations) {
    const replay = replayCompletionOperation(replayed, item)
    if (!replay.ok) throw new Error(replay.issues[0]?.message || '填写操作无法核对')
    replayed = replay.document
  }
  if (JSON.stringify(replayed) !== JSON.stringify(next)) throw new Error('填写操作与简历不一致，请重新打开编辑')
  const journal = current.completion_edit
  if (journal && journal.documentId !== next.documentId) throw new Error('填写记录属于另一份简历，请重新打开')
  return {documentId: next.documentId, baseRevision: journal?.baseRevision ?? base.revision,
    operations: [...(journal?.operations ?? []), ...operations]}
}

/** 只移除本次已确认的前缀，保存请求期间新发生的编辑继续等待下次保存。 */
export function acknowledgeCompletionEdits(current: OptimizedResume, submitted: OptimizedResume): OptimizedResume {
  const pending = current.completion_edit
  const acknowledged = submitted.completion_edit
  if (!pending || !acknowledged || pending.documentId !== acknowledged.documentId
    || pending.baseRevision !== acknowledged.baseRevision
    || JSON.stringify(pending.operations.slice(0, acknowledged.operations.length)) !== JSON.stringify(acknowledged.operations)) return current
  const remaining = pending.operations.slice(acknowledged.operations.length)
  const {completion_edit: _journal, ...rest} = current
  return remaining.length ? {...rest, completion_edit: {documentId: pending.documentId,
    baseRevision: submitted.completion_document!.revision, operations: remaining}} : rest
}

/** 冲突选择本地稿时重放可核对的编辑，不能只替换历史版本号。 */
export function rebaseCompletionEdits(
  baseline: ResumeCompletionDocument | undefined,
  history: OptimizedResume,
  local: OptimizedResume,
): OptimizedResume {
  const current = history.completion_document
  const target = local.completion_document
  const journal = local.completion_edit
  const conflict = () => new Error('本地编辑无法安全合并，请先载入历史版本，再修改对应位置；本地编辑稿仍已保留')
  if (!baseline || !current || !target || !journal || !journal.operations.length
    || [baseline, current, target].some(document => document.schemaVersion === 'resume-completion-v1' || !validateCompletionDocument(document).ok)
    || current.documentId !== baseline.documentId || target.documentId !== baseline.documentId
    || journal.documentId !== baseline.documentId || journal.baseRevision !== baseline.revision) throw conflict()
  let checked = baseline
  for (const operation of journal.operations) {
    const result = replayCompletionOperation(checked, operation)
    if (!result.ok) throw conflict()
    checked = result.document
  }
  if (JSON.stringify(checked) !== JSON.stringify(target)) throw conflict()

  const structure = (value: unknown): string => JSON.stringify(value, (key, item) => key === 'fill' ? undefined : item)
  const containingBlock = (document: ResumeCompletionDocument, gapId: string) => document.blocks.find(block => block.segments.some(segment =>
    segment.kind === 'optional_gap_clause' || segment.kind === 'identity_gap' ? segment.gapId === gapId : segment.kind === 'dependent_claim'
      && segment.parts.some(part => part.kind === 'required_detail_gap' && part.gapId === gapId)))
  function forward(operation: CompletionForwardOperation, original: ResumeCompletionDocument, next: ResumeCompletionDocument): CompletionForwardOperation {
    if (operation.kind === 'resolve_claim') {
      const claimState = (document: ResumeCompletionDocument) => JSON.stringify({claim: document.blocks.flatMap(b => b.segments)
        .find(s => s.kind === 'dependent_claim' && s.claimId === operation.claimId), lineage: document.claimLineage?.find(s => s.claimId === operation.claimId)})
      if (claimState(original) !== claimState(next)) throw conflict()
      return {...operation, documentId: next.documentId, baseRevision: next.revision}
    }
    if (operation.kind === 'row') {
      const before = original.blocks.find(block => block.blockId === operation.blockId)
      const after = next.blocks.find(block => block.blockId === operation.blockId)
      if (!before || JSON.stringify(before) !== JSON.stringify(after)) throw conflict()
      return {...operation, documentId: next.documentId, baseRevision: next.revision}
    }
    const before = containingBlock(original, operation.command.gapId)
    const after = containingBlock(next, operation.command.gapId)
    if (!before || !after || structure(before) !== structure(after)) throw conflict()
    const command = {...operation.command, documentId: next.documentId, baseRevision: next.revision}
    // 用户明确选择本地稿时，恢复字段的最终意图不依赖远端字段是否仍为 omitted。
    if (command.type === 'undo') {
      const fill = command.previousFill
      if (!fill) throw conflict()
      return {kind: 'gap', command: {...command, type: fill.state === 'filled' ? 'fill' : fill.state === 'omitted' ? 'omit' : 'clear',
        value: fill.state === 'filled' ? fill.value : undefined, previousFill: undefined}}
    }
    if (!findGap(next, command.gapId)) throw conflict()
    return {kind: 'gap', command}
  }
  let original = baseline
  let next = current
  const snapshots = new Map<number, ResumeCompletionDocument>([[original.revision, next]])
  const operations: CompletionOperation[] = []
  for (const operation of journal.operations) {
    let rebased: CompletionOperation
    if (operation.kind === 'restore') {
      const previousDocument = snapshots.get(operation.previousDocument.revision)
      if (!previousDocument) throw conflict()
      const mappedForward = forward(operation.operation, operation.previousDocument, previousDocument)
      const replayed = replayCompletionOperation(previousDocument, mappedForward)
      if (!replayed.ok || JSON.stringify(replayed.document) !== JSON.stringify(next)) throw conflict()
      rebased = {kind: 'restore', documentId: next.documentId, baseRevision: next.revision, previousDocument, operation: mappedForward}
    } else rebased = forward(operation, original, next)
    const result = replayCompletionOperation(next, rebased)
    const originalResult = replayCompletionOperation(original, operation)
    if (!result.ok || !originalResult.ok) throw conflict()
    if (result.changed) operations.push(rebased)
    next = result.document
    original = originalResult.document
    snapshots.set(original.revision, next)
  }
  const {completion_edit: _previous, ...rest} = local
  return {...rest, optimized_resume: serializeDraft(next), completion_document: next,
    ...(operations.length ? {completion_edit: {documentId: next.documentId, baseRevision: current.revision, operations}} : {})}
}
