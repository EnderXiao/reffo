import {apiClient} from '../api'
import {resumeExportApi, type ResumeExportMetadata} from '../resumeExport'

const target = {historyId: 'history/one', documentId: 'document', revision: 3}
const metadata: ResumeExportMetadata = {export_id: 'export', status: 'ready', document_id: 'document', revision: 3,
  disposition: 'draft_only', reason_codes: ['IDENTITY_NAME_MISSING'], file_name: '简历草稿.pdf', omitted_count: 2,
  omitted_claim_count: 1, download_path: 'https://untrusted.invalid/file'}

afterEach(() => jest.restoreAllMocks())

test('PDF 创建固定当前保存版本，二进制继续使用认证 API 而非公开路径', async () => {
  const post = jest.spyOn(apiClient, 'post').mockResolvedValue(metadata)
  const request = jest.spyOn(apiClient, 'request').mockResolvedValue({data: new Uint8Array([37, 80, 68, 70, 45]).buffer,
    statusCode: 200, header: {'content-type': 'application/pdf'}, success: true})
  await expect(resumeExportApi.create(target, 'request-once')).resolves.toEqual(metadata)
  expect(post).toHaveBeenCalledWith('/resume-history/history%2Fone/exports', {
    request_id: 'request-once', document_id: 'document', expected_revision: 3, format: 'pdf',
  }, {timeout: 120000})
  await resumeExportApi.file(target, metadata)
  expect(request).toHaveBeenCalledWith(expect.objectContaining({url: '/resume-history/history%2Fone/exports/export/file',
    responseType: 'arraybuffer'}))
})

test('错误正文不能作为 PDF 文件下载', async () => {
  jest.spyOn(apiClient, 'request').mockResolvedValue({data: new Uint8Array([123, 34, 101]).buffer,
    statusCode: 200, header: {}, success: true})
  await expect(resumeExportApi.file(target, metadata)).rejects.toThrow('PDF 检查')
})
