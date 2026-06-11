import React from 'react'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import Taro from '@tarojs/taro'
import Index from '../index'
import {useHistoryStore} from '@/store/historyStore'
import {useSourceResumeStore} from '@/store/sourceResumeStore'
import type {ResumeHistory} from '@/types'

jest.mock('@tarojs/taro', () => ({
  navigateTo: jest.fn(),
  showToast: jest.fn(),
  useDidShow: jest.fn(),
}))

jest.mock('@/components/business/HomeCardDeck', () => ({
  __esModule: true,
  default: ({cards}: any) => (
    <div>
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

  beforeEach(() => {
    jest.clearAllMocks()
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

  test('无源简历时应显示默认头部状态和创建 CTA', () => {
    render(<Index />)

    expect(screen.getByText('源简历')).toBeTruthy()
    expect(screen.getByText('创建 Reffo 简历')).toBeTruthy()
    expect(screen.getByText('点击以开始')).toBeTruthy()
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

  test('无源简历时点击源简历按钮应提示上传', () => {
    render(<Index />)

    fireEvent.click(screen.getByText('源简历'))

    expect(Taro.showToast).toHaveBeenCalledWith({
      title: '尚未上传源简历',
      icon: 'none',
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
    expect(screen.getByText('90')).toBeTruthy()
    expect(screen.getByText(/当前简历/)).toBeTruthy()
  })

  test('加载状态应显示加载提示', () => {
    mockLoading.isLoading = true

    render(<Index />)

    expect(screen.getByText('加载中...')).toBeTruthy()
  })

  test('错误状态应显示错误提示', () => {
    mockLoading.error = '加载失败'

    render(<Index />)

    expect(screen.getByText(/加载失败/)).toBeTruthy()
  })
})
