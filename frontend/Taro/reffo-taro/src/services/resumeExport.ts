import {apiClient} from './api'

export interface ResumeExportTarget {
  historyId: string
  documentId: string
  revision: number
}

export interface ResumeExportMetadata {
  export_id: string
  status: 'pending' | 'ready' | 'failed' | 'revoked' | 'expired'
  document_id: string
  revision: number
  disposition: 'application_ready' | 'draft_only'
  reason_codes: string[]
  file_name: string
  omitted_count: number
  omitted_claim_count: number
  download_path: string
}

function exportPath(target: ResumeExportTarget) {
  return `/resume-history/${encodeURIComponent(target.historyId)}/exports`
}

export const resumeExportApi = {
  async create(target: ResumeExportTarget, requestId: string): Promise<ResumeExportMetadata> {
    return apiClient.post<ResumeExportMetadata>(exportPath(target), {
      request_id: requestId, document_id: target.documentId, expected_revision: target.revision, format: 'pdf',
    }, {timeout: 120000})
  },
  async status(target: ResumeExportTarget, exportId: string): Promise<ResumeExportMetadata> {
    return apiClient.get<ResumeExportMetadata>(`${exportPath(target)}/${encodeURIComponent(exportId)}`)
  },
  async file(target: ResumeExportTarget, metadata: ResumeExportMetadata): Promise<ArrayBuffer> {
    // 文件始终走带当前账号认证的 API，不能把服务端路径作为公开下载链接。
    const response = await apiClient.request<ArrayBuffer>({
      url: `${exportPath(target)}/${encodeURIComponent(metadata.export_id)}/file`,
      method: 'GET', responseType: 'arraybuffer', dataType: 'text', timeout: 120000,
    })
    if (!(response.data instanceof ArrayBuffer) || new Uint8Array(response.data).slice(0, 5).join(',') !== '37,80,68,70,45') {
      throw new Error('下载文件未通过 PDF 检查，请稍后重试')
    }
    return response.data
  },
}
