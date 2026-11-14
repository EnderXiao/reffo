import {apiClient} from '../api'
import {SourceResumeApi, toSourceResumeSummaryMetaFromSummary} from '../sourceResume'

const parseId = '33333333-3333-4333-8333-333333333333'
const record = {id: 'source', title: '候选人', resume_markdown: '# 候选人', source_type: 'file' as const,
  parse_id: parseId, original_file_name: 'resume.pdf', created_at: '2026-11-12T00:00:00Z', updated_at: '2026-11-12T00:00:00Z'}

test('源简历保存和重新加载保留 OCR 来源，摘要不丢失关联', async () => {
  const post = jest.spyOn(apiClient, 'post').mockResolvedValue(record)
  const get = jest.spyOn(apiClient, 'get').mockResolvedValue(record)
  try {
    const api = new SourceResumeApi()
    const payload = {title: record.title, resume_markdown: record.resume_markdown, source_type: record.source_type, parse_id: parseId}
    const saved = await api.saveSourceResume(payload)
    expect(post).toHaveBeenCalledWith('/source-resume', payload)
    expect(saved.parseId).toBe(parseId)
    expect((await api.getLatestSourceResume())?.parseId).toBe(parseId)
    expect((await api.getLatestSourceResumeSummary())?.parseId).toBe(parseId)
    expect(toSourceResumeSummaryMetaFromSummary(saved).parseId).toBe(parseId)
  } finally {post.mockRestore(); get.mockRestore()}
})

test('无 OCR 的手输或旧记录不制造来源标识', async () => {
  const get = jest.spyOn(apiClient, 'get').mockResolvedValue({...record, source_type: 'manual', parse_id: null})
  try {expect((await new SourceResumeApi().getLatestSourceResume())?.parseId).toBeUndefined()}
  finally {get.mockRestore()}
})
