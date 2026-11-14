import {useEffect, useRef} from 'react'
import type {ResumeCompletionEditor} from '../model/useResumeCompletionEditor'

export function ResumeRowEditor({editor}: {editor: ResumeCompletionEditor}) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    inputRef.current?.focus({preventScroll: true})
    inputRef.current?.scrollIntoView?.({block: 'center', behavior: 'auto'})
  }, [])
  useEffect(() => {
    if (!inputRef.current) return
    inputRef.current.style.height = 'auto'
    inputRef.current.style.height = `${inputRef.current.scrollHeight}px`
  }, [editor.active?.draft])
  return <div className='reffo-result__markdown-editor reffo-completion__row-editor'>
    <textarea
      ref={inputRef}
      aria-label='修改整行简历'
      className='reffo-result__markdown-source'
      rows={1}
      disabled={editor.saving}
      value={editor.active?.draft ?? ''}
      onChange={event => editor.setDraft(event.currentTarget.value)}
      onCompositionStart={() => editor.setComposing(true)}
      onCompositionEnd={() => editor.setComposing(false)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return
        if (event.key === 'Escape') { event.preventDefault(); void editor.cancel() }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void editor.save() }
      }}
    />
    {editor.error && <p className='reffo-completion__error' role='alert'>{editor.error}</p>}
    <div className='reffo-completion__actions'>
      <button type='button' className='reffo-completion__action reffo-completion__action--primary' disabled={editor.saving} onClick={() => void editor.save()}>{editor.saving ? '保存中…' : '保存整行'}</button>
      <button type='button' className='reffo-completion__action reffo-completion__action--secondary' disabled={editor.saving} onClick={() => void editor.cancel()}>取消</button>
    </div>
  </div>
}
