import {useEffect, useRef} from 'react'
import {Image, Text} from '@tarojs/components'
import classNames from 'classnames'
import type {CompletionIssue, ResumeCompletionDocument} from '@/shared/resume-completion'
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

export function ResumeDocument({document, editor, issues, referenceLines}: {
  document: ResumeCompletionDocument
  editor: ResumeCompletionEditor
  issues: CompletionIssue[]
  referenceLines?: {start: number; end: number}
}) {
  const locatedRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!referenceLines || editor.active) return
    locatedRef.current?.scrollIntoView?.({block: 'center', behavior: 'auto'})
    locatedRef.current?.focus({preventScroll: true})
  }, [referenceLines?.start, referenceLines?.end, editor.active])

  return <div className='reffo-result__markdown'>
    {document.blocks.map((block, index) => {
      const rowEditing = editor.active?.kind === 'row' && editor.active.id === block.blockId
      const editable = block.kind !== 'blank' && block.kind !== 'divider'
      const blockIssue = issues.find(issue => issue.blockId === block.blockId)
      return <div
        key={block.blockId}
        data-block-id={block.blockId}
        ref={index === referenceLines?.start ? locatedRef : undefined}
        tabIndex={index === referenceLines?.start ? -1 : undefined}
        className={classNames('reffo-result__markdown-line', `reffo-result__markdown-line--${block.kind}`, {
          'reffo-result__markdown-line--located': referenceLines && index >= referenceLines.start && index <= referenceLines.end,
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
                  ? <span key={segment.segmentId}>{renderInlineMarkdown(segment.markdown)}</span>
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
