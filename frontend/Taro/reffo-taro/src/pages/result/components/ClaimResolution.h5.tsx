import {useState} from 'react'
import type {ClaimResolution as Resolution} from '@/shared/resume-completion'
import type {ResumeCompletionEditor} from '../model/useResumeCompletionEditor'

export function ClaimResolution({claimId, resolution, editor}: {claimId: string; resolution?: Resolution; editor: ResumeCompletionEditor}) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  return <span className='reffo-completion__resolution'>
    <span className='reffo-completion__help'>{resolution?.state === 'confirmed' ? '已由本人核对；材料来源仍为用户补充。'
      : resolution?.state === 'rejected' ? '本人选择不采用，下载将省略此结果。' : '填写完成后仍需本人核对结果及依据，未核对时下载将省略。'}</span>
    <button type='button' className='reffo-completion__action' disabled={editor.saving || Boolean(editor.active)} onClick={() => setOpen(!open)}>核对这项结果</button>
    {open && <span className='reffo-completion__editor' role='group' aria-label='核对结果依据'>
      <input className='reffo-completion__input' aria-label='核对依据' placeholder='填写实际核对来源、统计口径或冲突结论' value={note} onChange={event => setNote(event.currentTarget.value)} />
      <span className='reffo-completion__actions'>
        <button type='button' className='reffo-completion__action' disabled={!note.trim() || editor.saving} onClick={() => void editor.resolveClaim(claimId, {state: 'confirmed', note: note.trim(), origin: 'user'})}>已核对，可采用</button>
        <button type='button' className='reffo-completion__action' disabled={!note.trim() || editor.saving} onClick={() => void editor.resolveClaim(claimId, {state: 'rejected', note: note.trim(), origin: 'user'})}>不采用此结果</button>
        <button type='button' className='reffo-completion__action' disabled={editor.saving} onClick={() => setOpen(false)}>收起</button>
      </span>
    </span>}
  </span>
}
