import {beforeEach, describe, expect, jest, test} from '@jest/globals'

jest.mock('@/services/auth', () => ({
  authApi: {
    signOut: jest.fn(),
  },
}))

jest.mock('@/utils/user-data-storage', () => ({
  clearPersistedUserData: jest.fn(),
  getUserStorageKey: (baseKey: string, userId?: string | null) => userId ? `${baseKey}.${userId}` : baseKey,
  HISTORY_STORAGE_KEY: 'resume_histories',
  SOURCE_RESUME_STORAGE_KEY: 'latest_source_resume',
}))

import {authApi} from '@/services/auth'
import {clearPersistedUserData} from '@/utils/user-data-storage'
import {useAuthStore} from '../authStore'
import {useHistoryStore} from '../historyStore'
import {useSourceResumeStore} from '../sourceResumeStore'
import {useResumeStore} from '../resumeStore'
import {useJDStore} from '../jdStore'
import {useLandingFlowStore} from '../landingFlowStore'

describe('AuthStore signOut', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(authApi.signOut as jest.Mock).mockResolvedValue(undefined)
    ;(clearPersistedUserData as jest.Mock).mockResolvedValue(undefined)
    useAuthStore.setState({
      session: {
        accessToken: 'token',
        user: {id: 'user-1', email: 'user@example.com'},
      },
      initialized: true,
      loading: false,
      error: null,
    })
    useHistoryStore.setState({histories: [{id: 'history-1'} as never], initialized: true})
    useSourceResumeStore.setState({latestSourceResume: {id: 'resume-1'} as never, initialized: true})
    useResumeStore.getState().setResumeContent('private resume')
    useJDStore.getState().setJDContent('private jd')
    useLandingFlowStore.getState().startJobDescription({
      content: 'private jd',
      companyName: 'Company',
      positionName: 'Role',
      baseLocation: 'City',
    })
  })

  test('退出后清空当前账号缓存和所有业务内存状态', async () => {
    await useAuthStore.getState().signOut()

    expect(authApi.signOut).toHaveBeenCalledTimes(1)
    expect(clearPersistedUserData).toHaveBeenCalledWith('user-1')
    expect(useAuthStore.getState().session).toBeNull()
    expect(useHistoryStore.getState().histories).toEqual([])
    expect(useSourceResumeStore.getState().latestSourceResume).toBeNull()
    expect(useResumeStore.getState().resumeContent).toBe('')
    expect(useJDStore.getState().jdContent).toBe('')
    expect(useLandingFlowStore.getState().source).toBeNull()
  })
})
