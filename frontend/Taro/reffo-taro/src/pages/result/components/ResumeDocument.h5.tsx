import {useEffect, useRef} from 'react'
import {Image, Text} from '@tarojs/components'
import classNames from 'classnames'
import type {CompletionIssue, ResumeCompletionDocument} from '@/shared/resume-completion'
import type {ResumeActionAnchor} from '@/shared/resume-actions'
import type {ResumeCompletionEditor} from '../model/useResumeCompletionEditor'
import {CompletionGap} from './CompletionGap.h5'
import {ResumeRowEditor} from './ResumeRowEditor.h5'
import editIcon from '@/assets/result/edit.svg'

function renderInlineMarkdown(value: string) {
  return value.split(/(\\.|\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('\\')) return part.slice(1)
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index} className='reffo-result__markdown-strong'>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index} className='reffo-result__markdown-code'>{part.slice(1, -1)}</code>
    return part
  })
}

export function ResumeDocument({document, editor, issues, referenceLines, referenceAnchor, blocked = false}: {
  document: ResumeCompletionDocument
  editor: ResumeCompletionEditor
  issues: CompletionIssue[]
  referenceLines?: {start: number; end: number}
  referenceAnchor?: ResumeActionAnchor
  blocked?: boolean
}) {
  const locatedRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if ((!referenceLines && !referenceAnchor) || editor.active) return
    const row = locatedRef.current
    const gap = referenceAnchor?.gapId ? Array.from(row?.querySelectorAll<HTMLElement>('[data-gap-id]') ?? [])
      .find(button => button.dataset.gapId === referenceAnchor.gapId) : undefined
    const target = gap ?? row
    target?.scrollIntoView?.({block: 'center', behavior: 'auto'})
    target?.focus({preventScroll: true})
  }, [referenceLines?.start, referenceLines?.end, referenceAnchor, editor.active])

  return <div className='reffo-result__markdown'>
    {document.blocks.map((block, index) => {
      const rowEditing = editor.active?.kind === 'row' && editor.active.id === block.blockId
      const editable = !blocked && block.kind !== 'blank' && block.kind !== 'divider'
      const blockIssue = issues.find(issue => issue.blockId === block.blockId)
      const located = referenceAnchor ? block.blockId === referenceAnchor.blockId : Boolean(referenceLines && index >= referenceLines.start && index <= referenceLines.end)
      return <div
        key={block.blockId}
        data-block-id={block.blockId}
        data-unit-id={block.unitId}
        ref={located ? locatedRef : undefined}
        tabIndex={located ? -1 : undefined}
        className={classNames('reffo-result__markdown-line', `reffo-result__markdown-line--${block.kind}`, {
          'reffo-result__markdown-line--located': located,
          'reffo-completion__line--repair': Boolean(blockIssue),
        })}
      >
        {rowEditing ? <ResumeRowEditor editor={editor} /> : block.kind === 'divider'
          ? <div className='reffo-result__markdown-divider' />
          : <div className='reffo-result__markdown-rendered'>
              {block.kind === 'bullet' && <Text className='reffo-result__markdown-marker'>•</Text>}
              {block.kind === 'numbered' && <Text className='reffo-result__markdown-marker'>{block.prefix.trim()}</Text>}
              <span className='reffo-result__markdown-text'>
                {block.segments.map(segment => segment.kind === 'text'
                  ? <span key={segment.segmentId} data-segment-id={segment.segmentId} data-unit-id={segment.unitId}>{renderInlineMarkdown(segment.markdown)}</span>
                  : segment.kind === 'dependent_claim'
                    ? <span key={segment.claimId} className='reffo-completion__claim' data-claim-id={segment.claimId}>
                        {segment.parts.map(part => part.kind === 'text'
                          ? <span key={part.segmentId}>{renderInlineMarkdown(part.markdown)}</span>
                          : <CompletionGap key={part.gapId} gap={part} editor={editor} required />)}
                      </span>
                    : <CompletionGap key={segment.gapId} gap={segment} editor={editor} />)}
                {editable && <button type='button' className='reffo-completion__row-edit' aria-label={`修改第 ${index + 1} 行`} onClick={() => editor.openRow(block.blockId)}>
                  <Image className='reffo-result__markdown-edit-icon' src={editIcon} mode='aspectFit' />
                </button>}
              </span>
            </div>}
        {blockIssue && !rowEditing && <p className='reffo-completion__error'>{blockIssue.message}</p>}
      </div>
    })}
  </div>
}
