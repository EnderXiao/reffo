import {useEffect, useMemo, useRef, useState} from 'react'
import {Image, Text, View} from '@tarojs/components'
import classNames from 'classnames'
import {collectGaps, normalizeCompletionDocument, serializeDraft} from '@/shared/resume-completion'
import type {ResumeExportTarget} from '@/services/resumeExport'
import type {ProcessResult} from '@/types'
import {useAuthStore} from '@/store/authStore'
import {feedback} from '@/utils/feedback'
import {findResumeReferenceLines, isCurrentResumeReference, type ResumeReference} from '../model/analysisPresentation'
import {useResumeCompletionEditor, type CompletionCommit} from '../model/useResumeCompletionEditor'
import {ResumeDocument} from './ResumeDocument.h5'
import {downloadCompletionResume} from '../utils/resume-download.h5'
import downloadIcon from '@/assets/result/download.svg'
import './completion-editor.h5.scss'

export function ResumePanel({result, companyName, positionName, onOptimizedResumeChange, onCompletionDocumentChange,
  onEditingChange, saveStatus = 'idle', recoveryConflict = false, reference, prepareDownload, retryCompletionSave}: {
  result: ProcessResult
  companyName: string
  positionName: string
  onOptimizedResumeChange: (markdown: string) => Promise<void>
  onCompletionDocumentChange?: CompletionCommit
  onEditingChange?: (active: boolean) => void
  saveStatus?: 'idle' | 'saving' | 'failed'
  recoveryConflict?: boolean
  reference?: ResumeReference
  prepareDownload?: () => Promise<ResumeExportTarget>
  retryCompletionSave?: () => Promise<void>
}) {
  const loaded = useMemo(() => normalizeCompletionDocument(result.optimized.optimized_resume, result.optimized.completion_document),
    [result.optimized.optimized_resume, result.optimized.completion_document])
  const commit: CompletionCommit = onCompletionDocumentChange ?? (document => {
    if (document.schemaVersion !== 'resume-completion-v1') throw new Error('当前保存入口不支持关联结果，请重新打开页面后再编辑')
    return onOptimizedResumeChange(serializeDraft(document))
  })
  const editor = useResumeCompletionEditor(loaded.document, commit, onEditingChange, loaded.status === 'repair_required', saveStatus === 'saving')
  const containerRef = useRef<HTMLDivElement>(null)
  const nextGapRef = useRef(0)
  const [downloadError, setDownloadError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const documentRef = useRef(loaded.document)
  documentRef.current = loaded.document
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])
  const emptyGaps = collectGaps(loaded.document).filter(gap => gap.fill.state === 'empty')
  const isBusy = Boolean(downloading || loaded.blocked || editor.active || editor.saving || saveStatus !== 'idle' || recoveryConflict)
  const currentReference = !editor.active && reference && isCurrentResumeReference(reference, result) ? reference : undefined
  const referenceLines = currentReference && !('blockId' in currentReference)
    ? findResumeReferenceLines(result.optimized.optimized_resume, currentReference.quote) : undefined
  const referenceAnchor = currentReference && 'blockId' in currentReference ? currentReference : undefined
  const locateNext = () => {
    const buttons = Array.from(containerRef.current?.querySelectorAll<HTMLElement>('[data-gap-id]') ?? [])
      .filter(button => emptyGaps.some(gap => gap.gapId === button.dataset.gapId))
    if (!buttons.length) return
    const button = buttons[nextGapRef.current++ % buttons.length]
    button.scrollIntoView?.({block: 'center', behavior: 'auto'})
    button.focus({preventScroll: true})
  }
  const handleDownload = async () => {
    if (loaded.blocked) { setDownloadError('当前填写结构暂无法恢复，请刷新到兼容版本后重试。原始编辑稿已保留。'); return }
    if (isBusy) { feedback.message('请先保存或取消当前编辑'); return }
    if (loaded.status === 'repair_required') { setDownloadError('请先通过行末铅笔修复标出的内容，再下载。'); return }
    if (!prepareDownload) { setDownloadError('当前入口暂不支持正式下载，请从历史记录重新打开后重试'); return }
    setDownloading(true)
    setDownloadError('')
    const snapshot = loaded.document
    const owner = useAuthStore.getState().session?.user.id
    try {
      const target = await prepareDownload()
      const exported = await downloadCompletionResume(target, () => mountedRef.current && useAuthStore.getState().session?.user.id === owner
        && documentRef.current.documentId === snapshot.documentId && documentRef.current.revision === snapshot.revision)
      const omitted = exported.omitted_count || exported.omitted_claim_count
      const identityMissing = exported.reason_codes.includes('NAME_MISSING') || exported.reason_codes.includes('IDENTITY_NAME_MISSING')
      const draftReason = identityMissing ? '投递前请补充姓名' : exported.reason_codes.includes('CONTACT_MISSING')
        ? '投递前请补充联系方式' : '投递前请补齐必要信息'
      feedback.message(exported.disposition === 'draft_only'
        ? `已下载草稿，${draftReason}；编辑稿已保留。`
        : omitted ? `已下载 PDF，已省略 ${exported.omitted_count} 处未填补充${exported.omitted_claim_count ? `和 ${exported.omitted_claim_count} 条暂不可用结果` : ''}；编辑稿已保留。`
          : '已下载 PDF')
    } catch (error) {
      if (mountedRef.current) setDownloadError(error instanceof Error ? error.message : '下载失败，请重试')
    } finally { if (mountedRef.current) setDownloading(false) }
  }
  return <View className='reffo-result__panel reffo-result__panel--resume'>
    <div className='reffo-result__resume-paper' ref={containerRef}>
      <button type='button' className={classNames('reffo-result__download', {'reffo-result__download--disabled': isBusy})}
        aria-disabled={isBusy} onClick={() => void handleDownload()}>
        <Image className='reffo-result__download-icon' src={downloadIcon} mode='aspectFit' /><Text>{downloading ? '生成 PDF 中' : '下载'}</Text>
      </button>
      {emptyGaps.length > 0 && <button type='button' className='reffo-completion__remaining' onClick={locateNext}>还有 {emptyGaps.length} 处待补</button>}
      {loaded.status === 'repair_required' && <div className='reffo-completion__recovery' role='status'>
        <p className='reffo-completion__recovery-text'>{loaded.blocked ? '当前填写结构暂无法恢复，原始数据已保留。请刷新到兼容版本后重试。' : '部分填写状态需要确认，当前正文已保留。请通过行末铅笔检查并保存相关行。'}</p>
        {loaded.issues.filter(issue => !issue.blockId).map(issue => <p key={issue.code} className='reffo-completion__recovery-text'>{issue.message}</p>)}
      </div>}
      {saveStatus === 'failed' && <p className='reffo-completion__error' role='alert'>
        本地编辑稿已保留，当前版本尚待远端同步。
        {retryCompletionSave && <button type='button' className='reffo-completion__action' onClick={() => {
          void retryCompletionSave().catch(error => setDownloadError(error instanceof Error ? error.message : '同步失败，请重试'))
        }}>重试同步</button>}
      </p>}
      {downloadError && <p className='reffo-completion__error' role='alert'>{downloadError}</p>}
      {currentReference && <p className='reffo-result__analysis-caption' role='status'>已定位：{currentReference.location}</p>}
      <ResumeDocument document={loaded.document} editor={editor} issues={loaded.issues} referenceLines={referenceLines} referenceAnchor={referenceAnchor} blocked={loaded.blocked} />
      {!editor.active && (editor.error || editor.notice) && <p className={editor.error ? 'reffo-completion__error' : 'reffo-completion__notice'} role={editor.error ? 'alert' : 'status'}>
        {editor.error || editor.notice}
        {editor.undo && <button type='button' className='reffo-completion__action reffo-completion__action--undo' disabled={editor.saving} onClick={() => void editor.restore()}>撤销移除</button>}
      </p>}
    </div>
  </View>
}
