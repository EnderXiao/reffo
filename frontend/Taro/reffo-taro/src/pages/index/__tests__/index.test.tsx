import React from 'react'
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react'
import Taro from '@tarojs/taro'
import Index from '../index'
import {useHistoryStore} from '@/store/historyStore'
import {useSourceResumeStore} from '@/store/sourceResumeStore'
import type {ResumeHistory} from '@/types'

jest.mock('@tarojs/taro', () => ({
  navigateTo: jest.fn(),
  showToast: jest.fn(),
  useDidShow: jest.fn(),
  useRouter: jest.fn(() => ({params: {}})),
}))

jest.mock('@/components/business/HomeCardDeck', () => ({
  __esModule: true,
  default: ({cards, isCreateMode}: any) => (
    <div>
      {isCreateMode ? <div>新的申请</div> : null}
      {cards.slice(0, 3).map((card: any) => (
        <div key={card.id}>
          <span>{card.role}</span>
          <span>{card.score}</span>
          <span>% 匹配度</span>
        </div>
      ))}
    </div>
  ),
}))

jest.mock('@/store/historyStore')
jest.mock('@/store/sourceResumeStore')

const mockUseHistoryStore = useHistoryStore as jest.MockedFunction<typeof useHistoryStore>
const mockUseSourceResumeStore = useSourceResumeStore as jest.MockedFunction<
  typeof useSourceResumeStore
>

describe('首页组件', () => {
  const mockLoadHistories = jest.fn()
  const mockLoadLatestSourceResume = jest.fn()
  const mockLoading: {isLoading: boolean; error: string | null} = {
    isLoading: false,
    error: null,
  }
  const mockSourceResumeLoading: {isLoading: boolean; error: string | null} = {
    isLoading: false,
    error: null,
  }
  let mockHistories: ResumeHistory[] = []
  let mockLatestSourceResume: any = null
  let didShowCallbacks: Array<() => void> = []

  beforeEach(() => {
    jest.clearAllMocks()
    didShowCallbacks = []
    ;(Taro.useDidShow as jest.Mock).mockImplementation((callback: () => void) => {
      didShowCallbacks.push(callback)
    })
    mockHistories = []
    mockLatestSourceResume = null
    mockLoading.isLoading = false
    mockLoading.error = null
    mockSourceResumeLoading.isLoading = false
    mockSourceResumeLoading.error = null

    mockUseHistoryStore.mockReturnValue({
      histories: mockHistories,
      currentHistory: null,
      loading: mockLoading,
      loadHistories: mockLoadHistories,
      addHistory: jest.fn(),
      updateHistory: jest.fn(),
      deleteHistory: jest.fn(),
      clearHistories: jest.fn(),
      setCurrentHistory: jest.fn(),
      reset: jest.fn(),
    })
    mockUseSourceResumeStore.mockReturnValue({
      latestSourceResume: mockLatestSourceResume,
      loading: mockSourceResumeLoading,
      loadLatestSourceResume: mockLoadLatestSourceResume,
      setLatestSourceResume: jest.fn(),
      clearLatestSourceResume: jest.fn(),
      reset: jest.fn(),
    })
  })

  test('挂载时应加载历史记录和源简历状态', async () => {
    render(<Index />)

    await waitFor(() => {
      expect(mockLoadHistories).toHaveBeenCalledTimes(1)
      expect(mockLoadLatestSourceResume).toHaveBeenCalledTimes(1)
    })
  })

  test('无历史简历时应显示默认头部状态和新的申请卡片', () => {
    render(<Index />)

    expect(screen.getByText('源简历')).toBeTruthy()
    expect(screen.getByText('新的申请')).toBeTruthy()
    expect(screen.getByText('点击以开始')).toBeTruthy()
    expect(screen.queryByText('取消')).toBeNull()
  })

  test('已有源简历时应显示标题状态', () => {
    mockLatestSourceResume = {
      id: 'source-1',
      title: 'CV-Jeremy Smith',
      resumeMarkdown: '# CV-Jeremy Smith',
      sourceType: 'manual',
      originalFileName: 'CV-Jeremy Smith.md',
      createdAt: '2026-03-25T12:00:00.000Z',
      updatedAt: '2026-03-25T12:00:00.000Z',
    }
    mockUseSourceResumeStore.mockReturnValue({
      latestSourceResume: mockLatestSourceResume,
      loading: mockSourceResumeLoading,
      loadLatestSourceResume: mockLoadLatestSourceResume,
      setLatestSourceResume: jest.fn(),
      clearLatestSourceResume: jest.fn(),
      reset: jest.fn(),
    })

    render(<Index />)

    expect(screen.getByText('CV-Jeremy Smith')).toBeTruthy()
  })

  test('无源简历时点击源简历按钮应进入上传页', () => {
    render(<Index />)

    fireEvent.click(screen.getByText('源简历'))

    expect(Taro.navigateTo).toHaveBeenCalledWith({
      url: '/pages/create/index',
    })
  })

  test('已有源简历时点击源简历按钮应跳转到完成页', () => {
    mockLatestSourceResume = {
      id: 'source-1',
      title: 'CV-Jeremy Smith',
      resumeMarkdown: '# CV-Jeremy Smith',
      sourceType: 'manual',
      originalFileName: 'CV-Jeremy Smith.md',
      createdAt: '2026-03-25T12:00:00.000Z',
      updatedAt: '2026-03-25T12:00:00.000Z',
    }
    mockUseSourceResumeStore.mockReturnValue({
      latestSourceResume: mockLatestSourceResume,
      loading: mockSourceResumeLoading,
      loadLatestSourceResume: mockLoadLatestSourceResume,
      setLatestSourceResume: jest.fn(),
      clearLatestSourceResume: jest.fn(),
      reset: jest.fn(),
    })

    render(<Index />)

    fireEvent.click(screen.getByText('CV-Jeremy Smith'))

    expect(Taro.navigateTo).toHaveBeenCalledWith({
      url: '/pages/create/index?step=resumeSummary',
    })
  })

  test('有历史记录时应展示卡片列表和进度', () => {
    mockHistories = [
      {
        id: '1',
        position: '前端工程师',
        company: 'ABC 公司',
        name: '张三',
        createdAt: '2024-01-01T00:00:00.000Z',
        qualityScore: 85,
        matchScore: 90,
        tags: ['React', 'TypeScript'],
        resumeContent: '简历内容',
        jdContent: 'JD 内容',
        optimizedContent: '优化后的简历',
        cardColor: '#84cc16',
      },
      {
        id: '2',
        position: '后端工程师',
        company: 'XYZ 公司',
        name: '李四',
        createdAt: '2024-01-02T00:00:00.000Z',
        qualityScore: 88,
        matchScore: 92,
        tags: ['Node.js', 'Python'],
        resumeContent: '简历内容',
        jdContent: 'JD 内容',
        optimizedContent: '优化后的简历',
        cardColor: '#3b82f6',
      },
    ]
    mockUseHistoryStore.mockReturnValue({
      histories: mockHistories,
      currentHistory: null,
      loading: mockLoading,
      loadHistories: mockLoadHistories,
      addHistory: jest.fn(),
      updateHistory: jest.fn(),
      deleteHistory: jest.fn(),
      clearHistories: jest.fn(),
      setCurrentHistory: jest.fn(),
      reset: jest.fn(),
    })

    render(<Index />)

    expect(screen.getByText('前端工程师')).toBeTruthy()
    expect(screen.getByText('后端工程师')).toBeTruthy()
    expect(screen.getByText('85')).toBeTruthy()
    expect(screen.getByText(/当前简历/)).toBeTruthy()

    fireEvent.click(screen.getByText('创建 Reffo 简历'))

    expect(screen.getByText('取消')).toBeTruthy()
  })

  test('加载状态应保留首页内容并静默刷新', () => {
    mockLoading.isLoading = true

    render(<Index />)

    expect(screen.getByText('新的申请')).toBeTruthy()
    expect(screen.queryByText('加载中...')).toBeNull()
    expect(document.querySelector('.reffo-home')?.getAttribute('aria-busy')).toBe('true')
  })

  test('错误状态应保留首页内容而不覆盖页面', () => {
    mockLoading.error = '加载失败'

    render(<Index />)

    expect(screen.getByText('新的申请')).toBeTruthy()
    expect(screen.queryByText(/加载失败/)).toBeNull()
    expect(document.querySelector('.reffo-home')?.getAttribute('data-loading-error')).toBe('加载失败')
  })

  test('返回首页时应清理上一次导航的即时反馈', () => {
    render(<Index />)

    fireEvent.click(screen.getByText('登录'))
    expect(screen.getByText('打开中…')).toBeTruthy()

    act(() => {
      didShowCallbacks.forEach(callback => callback())
    })

    expect(screen.getByLabelText('登录')).toBeTruthy()
    expect(screen.queryByText('打开中…')).toBeNull()
  })
})
