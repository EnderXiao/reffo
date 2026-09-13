import {parseApi} from '../parse'
import {apiClient} from '../api'
import {getJSON} from '@/utils/storage'
import {resetPublicRuntimeConfigCache} from '../runtime-config'

jest.mock('../api', () => ({
  apiClient: {get: jest.fn(), post: jest.fn(), setAuthToken: jest.fn()},
}))
jest.mock('@/utils/storage', () => ({
  getJSON: jest.fn(), setJSON: jest.fn(), storage: {removeItem: jest.fn()},
}))

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
