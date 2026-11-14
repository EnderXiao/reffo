import { z } from 'zod'
import type { ResumeEvidenceBundle } from '@/v5/types'

interface MonthInterval { start: number; end: number; scopeId: string }
export interface ExperienceDuration {
  version: 'experience-duration-v2'
  policy: 'month_boundary_union_no_runtime_extension'
  sourceAsOf: string | null
  fullTime: { months: number | null; knownLowerBoundMonths: number; scopeIds: string[]; unresolvedScopeIds: string[] }
  internship: { months: number | null; knownLowerBoundMonths: number; scopeIds: string[]; unresolvedScopeIds: string[] }
  excludedScopeIds: string[]
  reasons: string[]
}

function monthIndex(value: string | null) {
  if (!value) return null
  const date = /^(\d{4})\s*[.\-/年]\s*(\d{1,2})(?:月|(?:[.\-/]\d{1,2})?)?$/u.exec(value.trim())
  if (!date || Number(date[2]) < 1 || Number(date[2]) > 12) return null
  return Number(date[1]) * 12 + Number(date[2]) - 1
}

function unionMonths(intervals: MonthInterval[]) {
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end)
  let total = 0, start: number | null = null, end = 0
  for (const interval of sorted) {
    if (start === null) { start = interval.start; end = interval.end }
    else if (interval.start <= end) end = Math.max(end, interval.end)
    else { total += end - start; start = interval.start; end = interval.end }
  }
  return total + (start === null ? 0 : end - start)
}

/** Dates are source facts. The runtime clock cannot extend an old resume's “present”. */
export function calculateExperienceDuration(resume: ResumeEvidenceBundle,
  options: { sourceAsOf?: string | null } = {}): ExperienceDuration {
  const sourceAsOf = options.sourceAsOf === undefined ? resume.sourceStructure?.sourceAsOf ?? null : options.sourceAsOf
  const asOfMonth = monthIndex(sourceAsOf)
  const reasons: string[] = [], excludedScopeIds: string[] = []
  const buckets = {
    fullTime: { intervals: [] as MonthInterval[], scopeIds: [] as string[], unresolvedScopeIds: [] as string[] },
    internship: { intervals: [] as MonthInterval[], scopeIds: [] as string[], unresolvedScopeIds: [] as string[] },
  }
  for (const item of resume.timeline) {
    if (!['experience', 'internship'].includes(item.kind)) { excludedScopeIds.push(item.scopeId); continue }
    const bucket = buckets[item.kind === 'internship' ? 'internship' : 'fullTime']
    bucket.scopeIds.push(item.scopeId)
    const start = monthIndex(item.start)
    const openEnded = Boolean(item.end && /^(?:至今|现在|目前|present|current|now)$/iu.test(item.end.trim()))
    const end = openEnded ? asOfMonth : monthIndex(item.end)
    if (start === null || end === null || end < start) {
      bucket.unresolvedScopeIds.push(item.scopeId)
      if (openEnded && asOfMonth === null) reasons.push(`${item.scopeId}为开放任职，未提供材料时点；不延长至本次运行日期。`)
      else reasons.push(`${item.scopeId}的起止月份不完整或不相容，未估算年限。`)
      continue
    }
    bucket.intervals.push({start, end, scopeId: item.scopeId})
  }
  const project = (bucket: typeof buckets.fullTime) => {
    const knownLowerBoundMonths = unionMonths(bucket.intervals)
    return {months: !bucket.scopeIds.length || bucket.unresolvedScopeIds.length ? null : knownLowerBoundMonths,
      knownLowerBoundMonths, scopeIds: bucket.scopeIds, unresolvedScopeIds: bucket.unresolvedScopeIds}
  }
  return {version: 'experience-duration-v2', policy: 'month_boundary_union_no_runtime_extension', sourceAsOf,
    fullTime: project(buckets.fullTime), internship: project(buckets.internship), excludedScopeIds, reasons}
}


const durationBucketSchema = z.object({months: z.number().nonnegative().nullable(), knownLowerBoundMonths: z.number().nonnegative(),
  scopeIds: z.array(z.string()), unresolvedScopeIds: z.array(z.string())}).strict()
export const experienceDurationSchema = z.object({version: z.literal('experience-duration-v2'),
  policy: z.literal('month_boundary_union_no_runtime_extension'), sourceAsOf: z.string().nullable(),
  fullTime: durationBucketSchema, internship: durationBucketSchema, excludedScopeIds: z.array(z.string()), reasons: z.array(z.string())}).strict()
