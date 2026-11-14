import {useEffect, useRef, useState} from 'react'
import {
  applyCompletionCommand,
  beginRowEdit,
  reconcileRowEdit,
  replayCompletionOperation,
  serializeDraft,
  resolveCompletionClaim,
  isCompletionV4,
  type ClaimResolution,
  type CompletionCommand,
  type CompletionOperation,
  type CompletionRowEditSession,
  type ResumeCompletionDocument,
  type GapField,
} from '@/shared/resume-completion'

export type CompletionCommit = (document: ResumeCompletionDocument, baseRevision: number, baseMarkdown: string, operation?: CompletionOperation | CompletionOperation[]) => Promise<void>

type ActiveEditor = {
  kind: 'gap' | 'row'
  id: string
  draft: string
  base: ResumeCompletionDocument
  row?: CompletionRowEditSession
}

type PendingCommit = {
  document: ResumeCompletionDocument
  base: ResumeCompletionDocument
  draft: string
  operation: 'fill' | 'omit' | 'undo' | 'cancel' | 'resolve'
  undo?: CompletionCommand
  notice?: string
  editOperation?: CompletionOperation | CompletionOperation[]
  forwardOperation?: CompletionOperation
  forwardBase?: ResumeCompletionDocument
}

const sameDocument = (left: ResumeCompletionDocument, right: ResumeCompletionDocument) => JSON.stringify(left) === JSON.stringify(right)

export function useResumeCompletionEditor(
  document: ResumeCompletionDocument,
  onCommit: CompletionCommit,
  onActiveChange?: (active: boolean) => void,
  persistUnchanged = false,
  locked = false,
) {
  const [active, setActive] = useState<ActiveEditor | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [undo, setUndo] = useState<CompletionCommand>()
  const pendingRef = useRef<PendingCommit | null>(null)
  const saveLockRef = useRef(false)
  const composingRef = useRef(false)
  const currentRef = useRef(document)
  currentRef.current = document

  useEffect(() => {
    onActiveChange?.(active !== null || saving)
  }, [active, saving, onActiveChange])
  useEffect(() => () => onActiveChange?.(false), [onActiveChange])

  const openGap = (gap: GapField) => {
    if (locked) return
    if (pendingRef.current?.operation === 'undo') {
      setError('请先重试保存撤销操作')
      return
    }
    if (active || saving) {
      setError('请先保存或取消当前编辑')
      return
    }
    setError('')
    setNotice('')
    pendingRef.current = null
    setActive({kind: 'gap', id: gap.gapId, draft: gap.fill.state === 'filled' ? gap.fill.value : '', base: document})
  }

  const openRow = (blockId: string) => {
    if (locked) return
    if (pendingRef.current?.operation === 'undo') {
      setError('请先重试保存撤销操作')
      return
    }
    if (active || saving) {
      setError('请先保存或取消当前编辑')
      return
    }
    const row = beginRowEdit(document, blockId)
    if (!row) return
    setError('')
    setNotice('')
    pendingRef.current = null
    setActive({kind: 'row', id: blockId, draft: row.draft, base: document, row})
  }

  const persist = async (submission: PendingCommit) => {
    pendingRef.current = submission
    await onCommit(submission.document, submission.base.revision, serializeDraft(submission.base), submission.editOperation)
    pendingRef.current = null
  }

  const save = async (operation: 'fill' | 'omit' = 'fill') => {
    if (!active || saveLockRef.current || composingRef.current) return
    saveLockRef.current = true
    setSaving(true)
    setError('')
    try {
      const pending = pendingRef.current
      let completed: PendingCommit
      if (pending && pending.operation !== 'cancel' && pending.draft === active.draft && (operation === 'fill' || pending.operation === operation)) {
        await persist(pending)
        completed = pending
      } else {
        const current = currentRef.current
        if (pending && !sameDocument(current, pending.document) && !sameDocument(current, active.base)) {
          setError('这份简历已更新，请取消后重新打开此处编辑')
          return
        }
        // 失败后改稿仍从本次编辑的原始范围重算，避免上次乐观写入的新增行残留。
        let base = active.base
        const replayOperations: CompletionOperation[] = []
        if (pending && current.schemaVersion !== 'resume-completion-v1' && sameDocument(current, pending.document)) {
          if (!pending.forwardOperation || pending.forwardOperation.kind === 'restore' || !pending.forwardBase) {
            setError('请先重试保存或取消当前编辑')
            return
          }
          const restoration: CompletionOperation = {kind: 'restore', documentId: current.documentId,
            baseRevision: current.revision, previousDocument: pending.forwardBase, operation: pending.forwardOperation}
          const restored = replayCompletionOperation(current, restoration)
          if (!restored.ok) {
            setError(restored.issues.map(issue => issue.message).join('；'))
            return
          }
          base = restored.document
          replayOperations.push(restoration)
        }
        const change = active.kind === 'row' && active.row
          ? reconcileRowEdit(base, base === active.base ? active.row : beginRowEdit(base, active.id)!, active.draft)
          : applyCompletionCommand(base, {
              documentId: base.documentId,
              baseRevision: base.revision,
              gapId: active.id,
              type: operation,
              value: active.draft,
            })
        if (!change.ok) {
          setError(change.issues.map(issue => issue.message).join('；'))
          return
        }
        const next = pending && current.schemaVersion === 'resume-completion-v1'
          ? {...change.document, revision: current.revision + 1} : change.document
        completed = {
          document: next,
          base: replayOperations.length || pending && current.schemaVersion === 'resume-completion-v1' ? current : base,
          draft: active.draft,
          operation,
          undo: change.undo ? {...change.undo, baseRevision: next.revision} : undefined,
          notice: change.notice,
          editOperation: change.operation ? [...replayOperations, change.operation] : replayOperations,
          forwardOperation: change.operation,
          forwardBase: base,
        }
        if (change.changed || persistUnchanged || pending) await persist(completed)
      }
      setUndo(completed.undo)
      setNotice(completed.notice || (completed.operation === 'omit' ? '已移除补充分句，可撤销' : '已保存到当前简历'))
      setActive(null)
    } catch (cause) {
      setError(`未保存，可重试：${cause instanceof Error ? cause.message : '当前会话写入失败'}`)
    } finally {
      saveLockRef.current = false
      setSaving(false)
    }
  }

  const cancel = async () => {
    if (saveLockRef.current) return
    const pending = pendingRef.current
    if (pending && active) {
      saveLockRef.current = true
      setSaving(true)
      try {
        const current = currentRef.current
        if (!sameDocument(current, pending.document) && !sameDocument(current, active.base)) {
          setError('这份简历已更新，无法撤回旧稿，请刷新后恢复最新内容')
          return
        }
        let cancellation = pending.operation === 'cancel' ? pending : {
          document: {...active.base, revision: current.revision + 1},
          base: current,
          draft: active.draft,
          operation: 'cancel' as const,
        }
        if (pending.operation !== 'cancel' && current.schemaVersion !== 'resume-completion-v1') {
          if (sameDocument(current, active.base)) {
            pendingRef.current = null
            setActive(null)
            setError('')
            return
          }
          if (!pending.forwardOperation || pending.forwardOperation.kind === 'restore' || !pending.forwardBase) {
            setError('无法核对要取消的编辑，请先重试保存')
            return
          }
          const restoration: CompletionOperation = {kind: 'restore', documentId: current.documentId,
            baseRevision: current.revision, previousDocument: pending.forwardBase, operation: pending.forwardOperation}
          const restored = replayCompletionOperation(current, restoration)
          if (!restored.ok) { setError(restored.issues[0]?.message || '无法恢复原稿'); return }
          cancellation = {...cancellation, document: restored.document, editOperation: restoration}
        }
        await persist(cancellation)
      } catch (cause) {
        setError(`取消未保存成功，请重试：${cause instanceof Error ? cause.message : '写入失败'}`)
        return
      } finally {
        saveLockRef.current = false
        setSaving(false)
      }
    }
    pendingRef.current = null
    setActive(null)
    setError('')
  }

  const restore = async () => {
    if (!undo || active || saveLockRef.current) return
    const base = currentRef.current
    const pending = pendingRef.current
    const restored = pending?.operation === 'undo'
      ? {ok: true as const, document: pending.document, operation: pending.editOperation}
      : applyCompletionCommand(base, undo)
    if (!restored.ok) {
      setError(restored.issues.map(issue => issue.message).join('；'))
      return
    }
    saveLockRef.current = true
    setSaving(true)
    try {
      await persist({document: restored.document, base: pending?.operation === 'undo' ? pending.base : base, draft: '__undo__', operation: 'undo', editOperation: restored.operation})
      setUndo(undefined)
      setNotice('已恢复补充分句')
      setError('')
    } catch (cause) {
      setError(`撤销未保存，可重试：${cause instanceof Error ? cause.message : '写入失败'}`)
    } finally {
      saveLockRef.current = false
      setSaving(false)
    }
  }

  const resolveClaim = async (claimId: string, resolution: ClaimResolution) => {
    if (isCompletionV4(currentRef.current)) return
    if (active || saveLockRef.current) { setError('请先保存或取消当前编辑'); return }
    const base = currentRef.current
    const pending = pendingRef.current?.operation === 'resolve' ? pendingRef.current : undefined
    const result = pending ? {ok: true as const, document: pending.document, operation: pending.editOperation}
      : resolveCompletionClaim(base, {kind: 'resolve_claim', documentId: base.documentId, baseRevision: base.revision, claimId, resolution})
    if (!result.ok) { setError(result.issues[0]?.message ?? '无法核对结果'); return }
    saveLockRef.current = true
    setSaving(true)
    try {
      await persist(pending ?? {document: result.document, base, draft: resolution.note, operation: 'resolve', editOperation: result.operation})
      setNotice(resolution.state === 'confirmed' ? '已记录你的核对依据；原始岗位匹配判断保留' : '已记录该结果不采用')
      setError('')
    } catch (cause) { setError(`核对结论未保存，请重试：${cause instanceof Error ? cause.message : '保存失败'}`) }
    finally { saveLockRef.current = false; setSaving(false) }
  }

  return {
    active, saving, error, notice, undo,
    openGap, openRow, save, cancel, restore, resolveClaim,
    setDraft: (draft: string) => setActive(current => current ? {...current, draft} : current),
    setComposing: (value: boolean) => { composingRef.current = value },
  }
}

export type ResumeCompletionEditor = ReturnType<typeof useResumeCompletionEditor>
