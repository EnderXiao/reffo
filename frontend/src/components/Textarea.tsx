import type { ChangeEventHandler } from 'react'

interface TextareaProps {
  value: string
  onChange: ChangeEventHandler<HTMLTextAreaElement>
  placeholder: string
  rows?: number
}

export function Textarea({ value, onChange, placeholder, rows = 20 }: TextareaProps) {
  return (
    <textarea
      className="input-textarea"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
    />
  )
}
