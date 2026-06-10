import type { ReactNode } from 'react'

interface ResultSectionProps {
  title: string
  children: ReactNode
}

export function ResultSection({ title, children }: ResultSectionProps) {
  return (
    <section className="result-section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}
