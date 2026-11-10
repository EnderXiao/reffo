import {useEffect, useId, useRef} from 'react'
import type {ResumeGapSegment} from '@/shared/resume-completion'
import type {ResumeCompletionEditor} from '../model/useResumeCompletionEditor'

export function CompletionGap({gap, editor}: {gap: ResumeGapSegment; editor: ResumeCompletionEditor}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const helpId = useId()
  const editing = editor.active?.kind === 'gap' && editor.active.id === gap.gapId
  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus({preventScroll: true})
    inputRef.current?.scrollIntoView?.({block: 'center', behavior: 'auto'})
  }, [editing])
  if (gap.fill.state === 'omitted' && !editing) return null

  return <>
    {gap.prefix}
    {editing ? (
      <span className='reffo-completion__editor' role='group' aria-label={`填写${gap.label}`}>
        <span className='reffo-completion__label'>待补：{gap.label}</span>
        <input
          ref={inputRef}
          className='reffo-completion__input'
          aria-label={gap.label}
          aria-describedby={helpId}
          placeholder={gap.instruction}
          value={editor.active?.draft ?? ''}
          disabled={editor.saving}
          onChange={event => editor.setDraft(event.currentTarget.value)}
          onCompositionStart={() => editor.setComposing(true)}
          onCompositionEnd={() => editor.setComposing(false)}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return
            if (event.key === 'Escape') { event.preventDefault(); void editor.cancel() }
            if (event.key === 'Enter') { event.preventDefault(); void editor.save() }
          }}
        />
        <span id={helpId} className='reffo-completion__help'>{gap.instruction}。{gap.benefit}。</span>
        {gap.candidates.length > 0 && <span className='reffo-completion__candidates'>
          <span className='reffo-completion__help'>仅选择自己实际完成的内容，可继续修改：</span>
          {gap.candidates.map(candidate => <button
            key={candidate.text}
            type='button'
            disabled={editor.saving}
            className='reffo-completion__candidate'
            onClick={() => { editor.setDraft(candidate.text); inputRef.current?.focus() }}
          >{candidate.text}</button>)}
        </span>}
        {editor.error && <span className='reffo-completion__error' role='alert'>{editor.error}</span>}
        <span className='reffo-completion__actions'>
          <button type='button' className='reffo-completion__action reffo-completion__action--primary' disabled={editor.saving} onClick={() => void editor.save()}>{editor.saving ? '保存中…' : '保存'}</button>
          <button type='button' className='reffo-completion__action reffo-completion__action--secondary' disabled={editor.saving} onClick={() => void editor.cancel()}>取消</button>
          <button type='button' className='reffo-completion__action reffo-completion__omit' disabled={editor.saving} onClick={() => void editor.save('omit')}>不补充，移除补充分句</button>
        </span>
      </span>
    ) : (
      <button
        type='button'
        className={`reffo-completion__gap${gap.fill.state === 'filled' ? ' reffo-completion__gap--filled' : ''}`}
        data-gap-id={gap.gapId}
        aria-label={`${gap.fill.state === 'filled' ? '修改' : '填写'}${gap.label}`}
        onClick={() => editor.openGap(gap)}
      >{gap.fill.state === 'filled' ? gap.fill.value : `〔待补：${gap.label}；${gap.benefit}〕`}</button>
    )}
    {gap.suffix}
  </>
}
