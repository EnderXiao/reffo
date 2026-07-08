export type ResumeGrade = 'A+' | 'A' | 'B' | 'C' | 'D'

export function resolveResumeGrade(score: number): ResumeGrade {
  if (score >= 90) return 'A+'
  if (score >= 80) return 'A'
  if (score >= 70) return 'B'
  if (score >= 60) return 'C'
  return 'D'
}
