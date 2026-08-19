import {beforeEach, describe, expect, jest, test} from '@jest/globals'
import type {SourceResumeSummary} from '@/types'

jest.mock('@/services/sourceResume', () => ({
  sourceResumeApi: {
    getLatestSourceResume: jest.fn(),
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
    jest.clearAllMocks()
    useSourceResumeStore.getState().reset()
    mockAuthState.session = {user: {id: 'user-1'}}
    ;(isLocalRuntimeEnvironment as jest.Mock).mockResolvedValue(false)
    ;(sourceResumeApi.getLatestSourceResume as jest.Mock).mockResolvedValue(null)
    ;(storage.removeItem as jest.Mock).mockResolvedValue(undefined)
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
})
