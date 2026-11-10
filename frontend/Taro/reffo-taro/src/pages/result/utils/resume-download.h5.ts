import {prepareResumeExport, type ResumeCompletionDocument} from '@/shared/resume-completion'
import type {ProcessResult} from '@/types'

function fileNamePart(value: string, fallback: string) {
  return value.replace(/[\\/:*?"<>|]/g, '').trim() || fallback
}

export function downloadCompletionResume(documentState: ResumeCompletionDocument, result: ProcessResult, company: string, position: string) {
  const prepared = prepareResumeExport(documentState, result.optimized.optimized_resume)
  if (!prepared.ok) return prepared
  const blob = new Blob([prepared.markdown], {type: 'text/markdown;charset=utf-8'})
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${fileNamePart(company, '目标公司')}-${fileNamePart(position, '目标岗位')}-${fileNamePart(result.analysis.structured_resume.personal_info.name, '用户')}-相契简历.md`
  document.body.appendChild(link)
  try { link.click() } finally {
    link.remove()
    URL.revokeObjectURL(url)
  }
  return prepared
}
