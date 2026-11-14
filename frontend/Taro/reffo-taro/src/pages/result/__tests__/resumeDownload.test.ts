import {resumeExportApi, type ResumeExportMetadata} from '@/services/resumeExport'
import {downloadCompletionResume} from '../utils/resume-download.h5'

const target = {historyId: 'history', documentId: 'document', revision: 2}
const metadata: ResumeExportMetadata = {export_id: 'export', status: 'ready', document_id: 'document', revision: 2,
  disposition: 'application_ready', file_name: '真实姓名_学校_岗位.pdf', omitted_count: 1, omitted_claim_count: 1,
  reason_codes: [], download_path: '/file'}

afterEach(() => jest.restoreAllMocks())

test('生成PDF期间版本变化时停止下载，不回退旧稿', async () => {
  let current = true
  jest.spyOn(resumeExportApi, 'create').mockImplementation(async () => {current = false; return metadata})
  const file = jest.spyOn(resumeExportApi, 'file')
  await expect(downloadCompletionResume(target, () => current)).rejects.toThrow('简历已更新')
  expect(file).not.toHaveBeenCalled()
})

test('服务器返回其他revision时拒绝下载', async () => {
  jest.spyOn(resumeExportApi, 'create').mockResolvedValue({...metadata, revision: 1})
  const file = jest.spyOn(resumeExportApi, 'file')
  await expect(downloadCompletionResume(target)).rejects.toThrow('下载版本与当前简历不一致')
  expect(file).not.toHaveBeenCalled()
})
