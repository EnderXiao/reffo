import {act, renderHook} from '@testing-library/react'
import type {PublicShareLink} from '@/types/share'

const mockNavigate = jest.fn()
const mockGetPublicLink = jest.fn()

jest.mock('@/services/share', () => ({
  shareApi: {
    getPublicLink: (...args: unknown[]) => mockGetPublicLink(...args),
  },
}))

jest.mock('@/shared/routing', () => ({
  routePaths: {
    create: '/pages/create/index',
  },
  usePageRoute: () => ({
    readString: () => 'public-token',
  }),
  useRouteTransition: () => ({
    navigate: mockNavigate,
  }),
}))

const {usePageModel} = require('../usePageModel') as typeof import('../usePageModel')

const share: PublicShareLink = {
  share_id: 'share-1',
  schema_version: 1,
  mode: 'job',
  theme: 'green',
  card: {
    kind: 'job',
    display_name: 'Jeremy Smith',
    company: 'Echo',
    position: 'AI Product Manager',
    location: '北京',
    generated_date: '2025.12.15',
    match_score: 88,
    summary_lines: [],
  },
  landing: {
    brand: 'Reffo',
    teaser_title: '一个岗位',
    teaser_subtitle: '一份专门准备的简历',
    teaser_hint: '尝试 Reffo',
    revealed_title: '用 Reffo 量身定制你的新简历',
    revealed_body: '智能弥合简历和岗位之间的差距。',
    cta: '即刻体验',
  },
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('share landing model', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockNavigate.mockReset()
    mockGetPublicLink.mockReset()
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  test('reveals the CTA after the configured delay and preserves attribution', async () => {
    mockGetPublicLink.mockResolvedValue(share)
    const {result} = renderHook(() => usePageModel())

    await flushPromises()
    expect(result.current.status).toBe('teaser')

    act(() => {
      jest.advanceTimersByTime(2499)
    })
    expect(result.current.status).toBe('teaser')

    act(() => {
      jest.advanceTimersByTime(1)
    })
    expect(result.current.status).toBe('revealed')

    act(() => {
      result.current.handleExperience()
    })
    expect(mockNavigate).toHaveBeenCalledWith('/pages/create/index', {
      source: 'share_link',
      shareId: 'share-1',
      shareMode: 'job',
    })
  })

  test('shows a retryable error for invalid shares', async () => {
    mockGetPublicLink.mockRejectedValue({
      code: 'SHARE_LINK_INVALID',
      message: 'not found',
    })
    const {result} = renderHook(() => usePageModel())

    await flushPromises()
    expect(result.current.status).toBe('error')
    expect(result.current.errorMessage).toBe('分享内容不存在')

    mockGetPublicLink.mockResolvedValue(share)
    act(() => {
      result.current.retry()
    })
    await flushPromises()
    expect(result.current.status).toBe('teaser')
  })
})
