import {parseApi, documentParseId} from '../parse'
import {apiClient} from '../api'
import {getJSON} from '@/utils/storage'
import {resetPublicRuntimeConfigCache} from '../runtime-config'

jest.mock('../api', () => ({
  apiClient: {get: jest.fn(), post: jest.fn(), setAuthToken: jest.fn()},
}))
jest.mock('@/utils/storage', () => ({
  getJSON: jest.fn(), setJSON: jest.fn(), storage: {removeItem: jest.fn()},
}))

describe('documentParseId', () => {
  const parseId = '22222222-2222-4222-8222-222222222222'
  const runId = '33333333-3333-4333-8333-333333333333'

  test('优先采用 parse_id，同时兼容旧解析响应的 run_id', () => {
    expect(documentParseId({parse_id: parseId, run_id: runId})).toBe(parseId)
    expect(documentParseId({run_id: runId})).toBe(runId)
    expect(documentParseId({})).toBeUndefined()
  })

  test('不把 OCR 文本或文件名作为解析关联标识', () => {
    expect(documentParseId({parse_id: '候选人负责 AI 产品规划'})).toBeUndefined()
    expect(documentParseId({run_id: 'jd-image.png'})).toBeUndefined()
  })
})

describe('resume upload authentication', () => {
  const originalFetch = globalThis.fetch
  const session = {accessToken: 'cached-token', user: {id: 'user-1'}}
  const file = new File(['%PDF'], 'resume.pdf', {type: 'application/pdf'})
  const pickedFile = {name: file.name, size: file.size, path: 'blob:resume', file}

  beforeEach(() => {
    jest.clearAllMocks()
    resetPublicRuntimeConfigCache()
    globalThis.fetch = jest.fn(async () => ({ok: true})) as unknown as typeof fetch
    ;(getJSON as jest.Mock).mockResolvedValue(session)
    ;(apiClient.post as jest.Mock).mockResolvedValue({rawText: 'test resume'})
  })

  afterEach(() => { globalThis.fetch = originalFetch })

  test('uploads inline in local no-login mode despite a cached cloud session', async () => {
    ;(apiClient.get as jest.Mock).mockResolvedValue({appEnv: 'local', authRequired: false})

    await parseApi.parseResumeFile(pickedFile)

    expect(apiClient.post).toHaveBeenCalledWith('/parse/resume-file', {
      file_name: 'resume.pdf', mime_type: 'application/pdf', content_base64: 'JVBERg==',
    }, {timeout: 180000})
    expect(apiClient.setAuthToken).toHaveBeenCalledWith(null)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  test('keeps authenticated private storage uploads for nonprod', async () => {
    ;(apiClient.get as jest.Mock).mockResolvedValue({
      appEnv: 'nonprod', authRequired: true,
      supabase: {url: 'https://example.supabase.co', publishableKey: 'public-key', storageBucket: 'user-files'},
    })

    await parseApi.parseResumeFile(pickedFile)

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/storage/v1/object/user-files/user-1/resume/'),
      expect.objectContaining({headers: expect.objectContaining({Authorization: 'Bearer cached-token'})}),
    )
    expect(apiClient.post).toHaveBeenCalledWith('/parse/resume-file', expect.objectContaining({
      storage_path: expect.stringContaining('user-1/resume/'),
    }), {timeout: 180000})
    expect((apiClient.post as jest.Mock).mock.calls[0][1]).not.toHaveProperty('content_base64')
  })
})
