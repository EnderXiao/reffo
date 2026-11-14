export type ResumeGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | '待评估'

export function resolveResumeGrade(score: number | null | undefined): ResumeGrade {
  if (score == null || !Number.isFinite(score)) return '待评估'
  if (score >= 90) return 'A+'
  if (score >= 80) return 'A'
  if (score >= 70) return 'B'
  if (score >= 60) return 'C'
  return 'D'
}
