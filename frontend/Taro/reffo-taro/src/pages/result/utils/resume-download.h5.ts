import {resumeExportApi, type ResumeExportTarget} from '@/services/resumeExport'

export async function downloadCompletionResume(target: ResumeExportTarget, isCurrent: () => boolean = () => true) {
  const assertCurrent = () => { if (!isCurrent()) throw new Error('简历已更新，请重新下载当前版本') }
  assertCurrent()
  const requestId = `pdf-${Date.now()}-${Math.random().toString(36).slice(2)}`
  let metadata = await resumeExportApi.create(target, requestId)
  for (let attempt = 0; metadata.status === 'pending' && attempt < 30; attempt += 1) {
    assertCurrent()
    await new Promise(resolve => setTimeout(resolve, 1000))
    metadata = await resumeExportApi.status(target, metadata.export_id)
  }
  if (metadata.status !== 'ready') throw new Error(metadata.status === 'pending' ? 'PDF 仍在生成，请稍后重试下载' : 'PDF 生成失败，请稍后重试')
  if (metadata.document_id !== target.documentId || metadata.revision !== target.revision) throw new Error('下载版本与当前简历不一致，请重试')
  assertCurrent()
  const bytes = await resumeExportApi.file(target, metadata)
  assertCurrent()
  const url = URL.createObjectURL(new Blob([bytes], {type: 'application/pdf'}))
  const link = document.createElement('a')
  link.href = url
  link.download = metadata.file_name
  document.body.appendChild(link)
  try { link.click() } finally {
    link.remove()
    URL.revokeObjectURL(url)
  }
  return metadata
}
