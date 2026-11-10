import {useMemo, useRef, useState} from 'react'
import {Image, Text, View} from '@tarojs/components'
import classNames from 'classnames'
import {normalizeCompletionDocument, serializeDraft} from '@/shared/resume-completion'
import type {ProcessResult, ResumeStrategyReference} from '@/types'
import {feedback} from '@/utils/feedback'
import {findResumeReferenceLines, hasStaleStrategyReview} from '../model/analysisPresentation'
import {useResumeCompletionEditor, type CompletionCommit} from '../model/useResumeCompletionEditor'
import {ResumeDocument} from './ResumeDocument.h5'
import {downloadCompletionResume} from '../utils/resume-download.h5'
import downloadIcon from '@/assets/result/download.svg'
import './completion-editor.h5.scss'

export function ResumePanel({result, companyName, positionName, onOptimizedResumeChange, onCompletionDocumentChange,
  onEditingChange, saveStatus = 'idle', recoveryConflict = false, reference}: {
  result: ProcessResult
  companyName: string
  positionName: string
  onOptimizedResumeChange: (markdown: string) => Promise<void>
  onCompletionDocumentChange?: CompletionCommit
  onEditingChange?: (active: boolean) => void
  saveStatus?: 'idle' | 'saving' | 'failed'
  recoveryConflict?: boolean
  reference?: ResumeStrategyReference
}) {
  const loaded = useMemo(() => normalizeCompletionDocument(result.optimized.optimized_resume, result.optimized.completion_document),
    [result.optimized.optimized_resume, result.optimized.completion_document])
  const commit: CompletionCommit = onCompletionDocumentChange ?? (document => onOptimizedResumeChange(serializeDraft(document)))
  const editor = useResumeCompletionEditor(loaded.document, commit, onEditingChange, loaded.status === 'repair_required')
  const containerRef = useRef<HTMLDivElement>(null)
  const nextGapRef = useRef(0)
  const [downloadError, setDownloadError] = useState('')
  const emptyGaps = loaded.document.blocks.flatMap(block => block.segments.filter(segment => segment.kind === 'optional_gap_clause' && segment.fill.state === 'empty'))
  const isBusy = Boolean(editor.active || editor.saving || saveStatus !== 'idle' || recoveryConflict)
  const referenceLines = !editor.active && !hasStaleStrategyReview(result) && reference
    ? findResumeReferenceLines(result.optimized.optimized_resume, reference.quote) : undefined
  const locateNext = () => {
    const buttons = Array.from(containerRef.current?.querySelectorAll<HTMLButtonElement>('[data-gap-id]') ?? [])
      .filter(button => emptyGaps.some(gap => gap.kind === 'optional_gap_clause' && gap.gapId === button.dataset.gapId))
    if (!buttons.length) return
    const button = buttons[nextGapRef.current++ % buttons.length]
    button.scrollIntoView?.({block: 'center', behavior: 'auto'})
    button.focus({preventScroll: true})
  }
  const handleDownload = () => {
    if (isBusy) { feedback.message('请先保存或取消当前编辑'); return }
    if (loaded.status === 'repair_required') {
      setDownloadError('请先通过行末铅笔修复标出的内容，再下载。')
      return
    }
    const exported = downloadCompletionResume(loaded.document, result, companyName, positionName)
    if (!exported.ok) {
      setDownloadError(exported.issues.map(issue => issue.message).join('；'))
      return
    }
    setDownloadError('')
    feedback.message(exported.omittedCount
      ? `已开始下载，已移除 ${exported.omittedCount} 处未填补充；编辑稿已保留。`
      : '已开始下载')
  }
  return <View className='reffo-result__panel reffo-result__panel--resume'>
    <div className='reffo-result__resume-paper' ref={containerRef}>
      <button type='button' className={classNames('reffo-result__download', {'reffo-result__download--disabled': isBusy})}
        aria-disabled={isBusy} onClick={handleDownload}>
        <Image className='reffo-result__download-icon' src={downloadIcon} mode='aspectFit' /><Text>下载</Text>
      </button>
      {emptyGaps.length > 0 && <button type='button' className='reffo-completion__remaining' onClick={locateNext}>还有 {emptyGaps.length} 处待补</button>}
      {loaded.status === 'repair_required' && <div className='reffo-completion__recovery' role='status'>
        <p className='reffo-completion__recovery-text'>部分填写状态需要确认，当前正文已保留。请通过行末铅笔检查并保存相关行。</p>
        {loaded.issues.filter(issue => !issue.blockId).map(issue => <p key={issue.code} className='reffo-completion__recovery-text'>{issue.message}</p>)}
      </div>}
      {downloadError && <p className='reffo-completion__error' role='alert'>{downloadError}</p>}
      {referenceLines && <p className='reffo-result__analysis-caption' role='status'>已定位：{reference?.location}</p>}
      <ResumeDocument document={loaded.document} editor={editor} issues={loaded.issues} referenceLines={referenceLines} />
      {!editor.active && (editor.error || editor.notice) && <p className={editor.error ? 'reffo-completion__error' : 'reffo-completion__notice'} role={editor.error ? 'alert' : 'status'}>
        {editor.error || editor.notice}
        {editor.undo && <button type='button' className='reffo-completion__action reffo-completion__action--undo' disabled={editor.saving} onClick={() => void editor.restore()}>撤销移除</button>}
      </p>}
    </div>
  </View>
}
