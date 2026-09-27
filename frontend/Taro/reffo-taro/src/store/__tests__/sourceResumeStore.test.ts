import {beforeEach, describe, expect, jest, test} from '@jest/globals'
import type {SourceResumeSummary} from '@/types'

jest.mock('@/services/sourceResume', () => ({
  ...jest.requireActual<typeof import('@/services/sourceResume')>(
    '@/services/sourceResume',
  ),
  sourceResumeApi: {
    saveSourceResume: jest.fn(),
    getLatestSourceResume: jest.fn(),
    getLatestSourceResumeSummary: jest.fn(),
    deleteSourceResume: jest.fn(),
  },
}))

jest.mock('@/services/runtime-config', () => ({
  isLocalRuntimeEnvironment: jest.fn(),
}))

const mockAuthState = {session: {user: {id: 'user-1'}} as {user: {id: string}} | null}

jest.mock('@/store/authStore', () => ({
  useAuthStore: {getState: () => mockAuthState},
}))

jest.mock('@/utils/storage', () => ({
  getJSON: jest.fn(),
  setJSON: jest.fn(),
  storage: {
    removeItem: jest.fn(),
  },
}))

import {sourceResumeApi} from '@/services/sourceResume'
import {isLocalRuntimeEnvironment} from '@/services/runtime-config'
import {useSourceResumeStore} from '../sourceResumeStore'
import {getJSON, setJSON, storage} from '@/utils/storage'
import {RequestError} from '@/utils/request'

const resume: SourceResumeSummary = {
  id: 'resume-1',
  title: '我的简历',
  resumeMarkdown: '# Resume',
  sourceType: 'file',
  originalFileName: 'resume.pdf',
  createdAt: '2026-08-18T00:00:00.000Z',
  updatedAt: '2026-08-18T00:00:00.000Z',
}

describe('SourceResumeStore', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    useSourceResumeStore.getState().reset()
    mockAuthState.session = {user: {id: 'user-1'}}
    ;(isLocalRuntimeEnvironment as jest.Mock).mockResolvedValue(false)
    ;(sourceResumeApi.getLatestSourceResume as jest.Mock).mockResolvedValue(null)
    ;(sourceResumeApi.getLatestSourceResumeSummary as jest.Mock).mockResolvedValue(null)
    ;(storage.removeItem as jest.Mock).mockResolvedValue(undefined)
    ;(sourceResumeApi.deleteSourceResume as jest.Mock).mockResolvedValue(undefined)
    ;(getJSON as jest.Mock).mockResolvedValue(null)
  })

  test('nonprod 接口失败时不读取或展示本地简历', async () => {
    ;(getJSON as jest.Mock).mockResolvedValue(resume)
    ;(sourceResumeApi.getLatestSourceResume as jest.Mock).mockRejectedValue(new Error('接口失败'))

    await useSourceResumeStore.getState().loadLatestSourceResume()

    expect(getJSON).not.toHaveBeenCalled()
    expect(useSourceResumeStore.getState().latestSourceResume).toBeNull()
    expect(useSourceResumeStore.getState().loading.error).toBe('接口失败')
  })

  test('nonprod 接口成功后不再写入业务缓存', async () => {
    ;(sourceResumeApi.getLatestSourceResume as jest.Mock).mockResolvedValue(resume)

    await useSourceResumeStore.getState().loadLatestSourceResume()

    expect(setJSON).not.toHaveBeenCalled()
    expect(storage.removeItem).toHaveBeenCalledWith('latest_source_resume.user-1')
    expect(useSourceResumeStore.getState().latestSourceResume).toEqual(resume)
  })

  test('首页摘要加载只请求元数据接口', async () => {
    ;(sourceResumeApi.getLatestSourceResumeSummary as jest.Mock).mockResolvedValue({
      id: resume.id,
      title: resume.title,
      sourceType: resume.sourceType,
      originalFileName: resume.originalFileName,
      createdAt: resume.createdAt,
      updatedAt: resume.updatedAt,
    })

    await useSourceResumeStore.getState().loadLatestSourceSummary()

    expect(sourceResumeApi.getLatestSourceResume).not.toHaveBeenCalled()
    expect(sourceResumeApi.getLatestSourceResumeSummary).toHaveBeenCalledTimes(1)
    expect(useSourceResumeStore.getState().latestSourceResume).toBeNull()
    expect(useSourceResumeStore.getState().latestSourceResumeSummary?.id).toBe(resume.id)
    expect(useSourceResumeStore.getState().summaryInitialized).toBe(true)
  })

  test('完整源简历加载后同步摘要元数据', async () => {
    ;(sourceResumeApi.getLatestSourceResume as jest.Mock).mockResolvedValue(resume)

    await useSourceResumeStore.getState().loadLatestSourceResume()

    expect(useSourceResumeStore.getState().latestSourceResumeSummary).toMatchObject({
      id: resume.id,
      title: resume.title,
      originalFileName: resume.originalFileName,
    })
  })

  test('未登录时读取 Landing 待同步简历，不请求受保护接口', async () => {
    mockAuthState.session = null
    ;(getJSON as jest.Mock).mockImplementation(async (key: string) => (
      key === 'reffo.landing.pendingSourceResume' ? resume : null
    ))

    await useSourceResumeStore.getState().loadLatestSourceResume()

    expect(sourceResumeApi.getLatestSourceResume).not.toHaveBeenCalled()
    expect(useSourceResumeStore.getState().latestSourceResume).toEqual(resume)
    expect(useSourceResumeStore.getState().loading.error).toBeNull()
  })
  function cacheRecords(records: Record<string, SourceResumeSummary>) {
    const cache = new Map(Object.entries(records))
    ;(getJSON as jest.Mock).mockImplementation(async (key: string) => cache.get(key) ?? null)
    ;(storage.removeItem as jest.Mock).mockImplementation(async (key: string) => {cache.delete(key)})
    return cache
  }

  test.each(['success', 'missing'] as const)('服务端删除 %s 后清除同一简历的所有缓存，重新加载不复活', async status => {
    mockAuthState.session = null
    const cache = cacheRecords({'latest_source_resume': resume, 'reffo.landing.pendingSourceResume': resume})
    useSourceResumeStore.setState({latestSourceResume: resume})
    if (status === 'missing') {
      ;(sourceResumeApi.deleteSourceResume as jest.Mock).mockRejectedValue(new RequestError('已删除', 'SOURCE_RESUME_NOT_FOUND', 404))
    }
    await useSourceResumeStore.getState().deleteLatestSourceResume(resume.id)
    expect(sourceResumeApi.deleteSourceResume).toHaveBeenCalledWith(resume.id)
    expect(cache.size).toBe(0)
    expect(useSourceResumeStore.getState().latestSourceResume).toBeNull()
    await useSourceResumeStore.getState().loadLatestSourceResume({force: true})
    expect(useSourceResumeStore.getState().latestSourceResume).toBeNull()
  })

  test('纯本地 Landing 简历删除不调用 API', async () => {
    mockAuthState.session = null
    const local = {...resume, id: 'landing-source-123456'}
    const cache = cacheRecords({'reffo.landing.pendingSourceResume': local})
    useSourceResumeStore.setState({latestSourceResume: local})
    await useSourceResumeStore.getState().deleteLatestSourceResume(local.id)
    expect(sourceResumeApi.deleteSourceResume).not.toHaveBeenCalled()
    expect(cache.size).toBe(0)
    expect(useSourceResumeStore.getState().latestSourceResume).toBeNull()
  })

  test.each([
    new RequestError('需登录', 'AUTH_REQUIRED', 401),
    new RequestError('网络失败', 'NETWORK_ERROR'),
    new RequestError('服务错误', 'SOURCE_RESUME_DELETE_FAILED', 500),
    new RequestError('接口不存在', 'NOT_FOUND', 404),
  ])('其他删除错误保留记录和缓存：%s', async error => {
    const cache = cacheRecords({'latest_source_resume.user-1': resume})
    useSourceResumeStore.setState({latestSourceResume: resume})
    ;(sourceResumeApi.deleteSourceResume as jest.Mock).mockRejectedValue(error)
    await expect(useSourceResumeStore.getState().deleteLatestSourceResume(resume.id)).rejects.toBe(error)
    expect(cache.get('latest_source_resume.user-1')).toEqual(resume)
    expect(useSourceResumeStore.getState().latestSourceResume).toEqual(resume)
    expect(storage.removeItem).not.toHaveBeenCalled()
  })

  test('删除旧记录时保留新简历和其他待同步简历', async () => {
    const newer = {...resume, id: 'new-resume'}
    const cache = cacheRecords({'latest_source_resume.user-1': resume, 'latest_source_resume': newer, 'reffo.landing.pendingSourceResume': newer})
    useSourceResumeStore.setState({latestSourceResume: resume})
    ;(sourceResumeApi.deleteSourceResume as jest.Mock).mockImplementation(async () => {
      useSourceResumeStore.setState({latestSourceResume: newer})
    })
    await useSourceResumeStore.getState().deleteLatestSourceResume(resume.id)
    expect(cache.has('latest_source_resume.user-1')).toBe(false)
    expect(cache.get('latest_source_resume')).toEqual(newer)
    expect(cache.get('reffo.landing.pendingSourceResume')).toEqual(newer)
    expect(useSourceResumeStore.getState().latestSourceResume).toEqual(newer)
  })

  test('删除前发起的加载响应不能恢复已删简历', async () => {
    let finishLoad!: (value: SourceResumeSummary) => void
    let started!: () => void
    const loading = new Promise<void>(resolve => {started = resolve})
    ;(sourceResumeApi.getLatestSourceResume as jest.Mock).mockImplementation(() => {
      started()
      return new Promise(resolve => {finishLoad = resolve})
    })
    useSourceResumeStore.setState({latestSourceResume: resume})
    const pending = useSourceResumeStore.getState().loadLatestSourceResume()
    await loading
    await useSourceResumeStore.getState().deleteLatestSourceResume(resume.id)
    finishLoad(resume)
    await pending
    expect(useSourceResumeStore.getState().latestSourceResume).toBeNull()
  })

  test('删除期间切换账号不清除新会话缓存', async () => {
    cacheRecords({'latest_source_resume.user-1': resume})
    ;(sourceResumeApi.deleteSourceResume as jest.Mock).mockImplementation(async () => {
      useSourceResumeStore.getState().reset()
      mockAuthState.session = {user: {id: 'user-2'}}
    })
    await useSourceResumeStore.getState().deleteLatestSourceResume(resume.id)
    expect(storage.removeItem).not.toHaveBeenCalled()
  })

})
