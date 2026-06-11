import React from 'react'
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react'
import Taro, {useRouter} from '@tarojs/taro'
import {resumeApi} from '@/services/resume'
import {sourceResumeApi} from '@/services/sourceResume'
import {useJDStore, useResumeStore, useSourceResumeStore} from '@/store'
import CreatePage from '../index'

const defaultProcessResult = {
  analysis: {
    quality_score: 87,
    strengths: [],
    weaknesses: [],
    suggestions: [],
    capability_summary: '',
    structured_resume: {
      personal_info: {name: 'Jeremy Smith'},
      education: [],
      experience: [],
      projects: [],
      skills: {hard_skills: [], soft_skills: []},
    },
  },
  matching: {
    match_score: 91,
    hard_requirements_match: [],
    skill_match: {
      matched_skills: ['React', 'TypeScript'],
      missing_skills: [],
      match_percentage: 91,
    },
    experience_match: {
      years_required: 0,
      years_actual: 0,
      relevant_experience: [],
      match_percentage: 0,
    },
    optimization_suggestions: [],
  },
  optimized: {
    optimized_resume: '# Jeremy Smith\n\n## Optimized',
    changes_summary: [],
    improvement_score: 4,
  },
}

function createDeferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return {promise, resolve, reject}
}

jest.mock('expo-image-picker', () => ({
  MediaTypeOptions: {
    Images: 'Images',
  },
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}))

jest.mock('expo-file-system', () => ({
  getInfoAsync: jest.fn(),
}))

jest.mock('@/services/sourceResume', () => ({
  sourceResumeApi: {
    saveSourceResume: jest.fn(),
    getLatestSourceResume: jest.fn(),
  },
}))

jest.mock('@/services/resume', () => ({
  resumeApi: {
    processResume: jest.fn(),
  },
}))

jest.mock('react-native', () => {
  const MockStatusBar = () => null
  ;(MockStatusBar as any).currentHeight = 0
  const MockView = ({children, ...props}: any) => <div {...props}>{children}</div>
  const createAnimation = () => ({
    start: (callback?: (result: {finished: boolean}) => void) =>
      callback?.({finished: true}),
    stop: jest.fn(),
  })
  class MockAnimatedValue {
    private value: number

    constructor(initialValue: number) {
      this.value = initialValue
    }

    setValue = (nextValue: number) => {
      this.value = nextValue
    }

    interpolate = () => this.value
  }

  return {
    Platform: {
      OS: 'ios',
    },
    StatusBar: MockStatusBar,
    View: MockView,
    Animated: {
      Value: MockAnimatedValue,
      View: MockView,
      timing: createAnimation,
      spring: createAnimation,
      parallel: createAnimation,
      sequence: createAnimation,
      loop: createAnimation,
    },
    Easing: {
      out: (value: unknown) => value,
      cubic: 'cubic',
      linear: 'linear',
    },
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
      absoluteFill: {},
      absoluteFillObject: {},
    },
    useWindowDimensions: () => ({
      width: 393,
      height: 852,
    }),
  }
})

describe('CreatePage', () => {
  const mockChooseMessageFile = Taro.chooseMessageFile as jest.Mock
  const mockNavigateBack = Taro.navigateBack as jest.Mock
  const mockNavigateTo = Taro.navigateTo as jest.Mock
  const mockShowToast = Taro.showToast as jest.Mock
  const mockReadFile = jest.fn()
  const mockUseRouter = useRouter as jest.Mock
  const mockSaveSourceResume = sourceResumeApi.saveSourceResume as jest.Mock
  const mockGetLatestSourceResume = sourceResumeApi.getLatestSourceResume as jest.Mock
  const mockProcessResume = resumeApi.processResume as jest.Mock
  const mockExpoImagePicker = jest.requireMock('expo-image-picker') as {
    requestMediaLibraryPermissionsAsync: jest.Mock
    launchImageLibraryAsync: jest.Mock
  }
  const mockExpoFileSystem = jest.requireMock('expo-file-system') as {
    getInfoAsync: jest.Mock
  }

  const renderPage = async () => {
    await act(async () => {
      render(<CreatePage />)
      await Promise.resolve()
    })
  }

  beforeEach(async () => {
    jest.clearAllMocks()
    jest.useRealTimers()
    mockUseRouter.mockReturnValue({params: {}})
    useResumeStore.getState().reset()
    useJDStore.getState().reset()
    useSourceResumeStore.getState().reset()
    ;(Taro as any).chooseMessageFile = mockChooseMessageFile
    ;(Taro.getFileSystemManager as jest.Mock).mockReturnValue({
      readFile: mockReadFile,
    })
    mockReadFile.mockReset()
    mockExpoImagePicker.requestMediaLibraryPermissionsAsync.mockReset()
    mockExpoImagePicker.launchImageLibraryAsync.mockReset()
    mockExpoFileSystem.getInfoAsync.mockReset()
    mockGetLatestSourceResume.mockResolvedValue(null)
    mockSaveSourceResume.mockResolvedValue({
      id: 'source-resume-1',
      title: 'Jeremy Smith',
      resumeMarkdown: '# Jeremy Smith\n\n## Experience\n- Built growth platform',
      sourceType: 'manual',
      originalFileName: 'Jeremy Smith.md',
      createdAt: '2026-03-25T12:00:00.000Z',
      updatedAt: '2026-03-25T12:00:00.000Z',
    })
    mockProcessResume.mockResolvedValue(defaultProcessResult)
  })

  test('应该渲染新的单页流程容器', async () => {
    await renderPage()

    expect(screen.getByText('编辑')).toBeTruthy()
    expect(screen.getByText('源简历')).toBeTruthy()
    expect(screen.getByText('上传源简历')).toBeTruthy()
    expect(screen.getByText('输入 Markdown 简历')).toBeTruthy()
    expect(screen.getByText('保存源简历')).toBeTruthy()
  })

  test('未提供内容时点击保存会提示校验信息', async () => {
    await renderPage()

    await act(async () => {
      fireEvent.click(screen.getByTestId('create-flow-primary-action'))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '请先填写或整理 Markdown 简历',
          icon: 'none',
        }),
      )
    })
  })

  test('输入 markdown 后保存会进入源简历完成页', async () => {
    await renderPage()

    fireEvent.change(screen.getByTestId('resume-markdown-input'), {
      target: {value: '# Jeremy Smith\n\n## 工作经历\n- 负责电商平台和设计系统建设'},
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('create-flow-primary-action'))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(mockSaveSourceResume).toHaveBeenCalledWith({
        title: 'Jeremy Smith',
        resume_markdown: '# Jeremy Smith\n\n## 工作经历\n- 负责电商平台和设计系统建设',
        source_type: 'manual',
        original_file_name: 'Jeremy Smith.md',
      })
    })

    await waitFor(() => {
      expect(screen.getByText('源简历文件')).toBeTruthy()
      expect(screen.getByText('Jeremy Smith.md')).toBeTruthy()
      expect(screen.getByText('编辑源简历')).toBeTruthy()
    })
  })

  test('源简历完成页点击主按钮会返回编辑态', async () => {
    await renderPage()

    fireEvent.change(screen.getByTestId('resume-markdown-input'), {
      target: {value: '# Jeremy Smith\n\n## 工作经历\n- 负责电商平台和设计系统建设'},
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('create-flow-primary-action'))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByText('源简历文件')).toBeTruthy()
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('create-flow-primary-action'))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByText('上传源简历')).toBeTruthy()
      expect(screen.getByTestId('resume-markdown-input')).toBeTruthy()
    })
  })

  test('已有源简历时可通过路由直接进入 JD 步骤', async () => {
    const existingSourceResume = {
      id: 'source-resume-1',
      title: 'Jeremy Smith',
      resumeMarkdown: '# Jeremy Smith\n\n## Experience\n- Built growth platform',
      sourceType: 'manual' as const,
      originalFileName: 'Jeremy Smith.md',
      createdAt: '2026-03-25T12:00:00.000Z',
      updatedAt: '2026-03-25T12:00:00.000Z',
    }
    mockGetLatestSourceResume.mockResolvedValue(existingSourceResume)
    await useSourceResumeStore.getState().setLatestSourceResume(existingSourceResume)
    mockUseRouter.mockReturnValue({params: {step: 'jobDescription'}})

    await renderPage()

    await waitFor(() => {
      expect(screen.getByText('新的')).toBeTruthy()
      expect(screen.getByText('申请')).toBeTruthy()
      expect(screen.getByText('目标岗位描述')).toBeTruthy()
    })
  })

  test('第二步提交会调用生成接口并跳转到结果页', async () => {
    const existingSourceResume = {
      id: 'source-resume-1',
      title: 'Jeremy Smith',
      resumeMarkdown: '# Jeremy Smith\n\n## Experience\n- Built growth platform',
      sourceType: 'manual' as const,
      originalFileName: 'Jeremy Smith.md',
      createdAt: '2026-03-25T12:00:00.000Z',
      updatedAt: '2026-03-25T12:00:00.000Z',
    }
    mockGetLatestSourceResume.mockResolvedValue(existingSourceResume)
    await useSourceResumeStore.getState().setLatestSourceResume(existingSourceResume)
    mockUseRouter.mockReturnValue({params: {step: 'jobDescription'}})

    await renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('job-mode-manual')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('job-mode-manual'))

    fireEvent.change(screen.getByTestId('job-company-input'), {
      target: {value: 'OpenAI'},
    })
    fireEvent.change(screen.getByTestId('job-position-input'), {
      target: {value: '前端工程师'},
    })
    fireEvent.change(screen.getByTestId('job-description-input'), {
      target: {
        value: '负责复杂前端应用开发与架构设计，推动高质量交付并优化体验。',
      },
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('create-flow-primary-action'))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(mockProcessResume).toHaveBeenCalledWith(
        '# Jeremy Smith\n\n## Experience\n- Built growth platform',
        '公司名称：OpenAI\n\n岗位名称：前端工程师\n\n负责复杂前端应用开发与架构设计，推动高质量交付并优化体验。',
      )
    })

    await waitFor(() => {
      expect(mockNavigateTo).toHaveBeenCalledWith({
        url: '/pages/result/index',
      })
    })

    await waitFor(() => {
      expect(screen.getByText('开始生成最佳简历')).toBeTruthy()
    })
  })

  test('第二步提交后应先进入 AI 分析态并展示关键信息', async () => {
    const existingSourceResume = {
      id: 'source-resume-1',
      title: 'Jeremy Smith',
      resumeMarkdown: '# Jeremy Smith\n\n## Experience\n- Built growth platform',
      sourceType: 'manual' as const,
      originalFileName: 'Jeremy Smith.md',
      createdAt: '2026-03-25T12:00:00.000Z',
      updatedAt: '2026-03-25T12:00:00.000Z',
    }
    const deferred = createDeferredPromise<typeof defaultProcessResult>()
    mockProcessResume.mockReturnValue(deferred.promise)
    mockGetLatestSourceResume.mockResolvedValue(existingSourceResume)
    await useSourceResumeStore.getState().setLatestSourceResume(existingSourceResume)
    mockUseRouter.mockReturnValue({params: {step: 'jobDescription'}})

    await renderPage()

    fireEvent.click(screen.getByTestId('job-mode-manual'))
    fireEvent.change(screen.getByTestId('job-company-input'), {
      target: {value: 'OpenAI'},
    })
    fireEvent.change(screen.getByTestId('job-position-input'), {
      target: {value: '前端工程师'},
    })
    fireEvent.change(screen.getByTestId('job-description-input'), {
      target: {
        value: '负责复杂前端应用开发与架构设计，推动高质量交付并优化体验。',
      },
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('create-flow-primary-action'))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByTestId('create-analysis-stage')).toBeTruthy()
      expect(screen.getByText('正在分析')).toBeTruthy()
      expect(screen.getAllByText('简历 · Jeremy Smith').length).toBeGreaterThan(0)
      expect(screen.getAllByText('公司 · OpenAI').length).toBeGreaterThan(0)
    })

    await act(async () => {
      deferred.resolve(defaultProcessResult)
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(mockNavigateTo).toHaveBeenCalledWith({
        url: '/pages/result/index',
      })
    })
  })

  test('分析态取消后应忽略晚到的生成结果', async () => {
    const existingSourceResume = {
      id: 'source-resume-1',
      title: 'Jeremy Smith',
      resumeMarkdown: '# Jeremy Smith\n\n## Experience\n- Built growth platform',
      sourceType: 'manual' as const,
      originalFileName: 'Jeremy Smith.md',
      createdAt: '2026-03-25T12:00:00.000Z',
      updatedAt: '2026-03-25T12:00:00.000Z',
    }
    const deferred = createDeferredPromise<typeof defaultProcessResult>()
    mockProcessResume.mockReturnValue(deferred.promise)
    mockGetLatestSourceResume.mockResolvedValue(existingSourceResume)
    await useSourceResumeStore.getState().setLatestSourceResume(existingSourceResume)
    mockUseRouter.mockReturnValue({params: {step: 'jobDescription'}})

    await renderPage()

    fireEvent.click(screen.getByTestId('job-mode-manual'))
    fireEvent.change(screen.getByTestId('job-description-input'), {
      target: {
        value: '负责复杂前端应用开发与架构设计，推动高质量交付并优化体验。',
      },
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('create-flow-primary-action'))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByTestId('create-analysis-stage')).toBeTruthy()
      expect(screen.queryByText('公司 · 目标公司待补充')).toBeNull()
      expect(screen.queryByText('岗位 · 目标岗位待补充')).toBeNull()
    })

    fireEvent.click(screen.getByTestId('analysis-cancel-action'))

    await waitFor(() => {
      expect(screen.queryByTestId('create-analysis-stage')).toBeNull()
    })

    await act(async () => {
      deferred.resolve(defaultProcessResult)
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(mockNavigateTo).not.toHaveBeenCalled()
    })
  })

  test('第二步上传岗位截图后可直接生成简历', async () => {
    jest.useFakeTimers()
    const existingSourceResume = {
      id: 'source-resume-1',
      title: 'Jeremy Smith',
      resumeMarkdown: '# Jeremy Smith\n\n## Experience\n- Built growth platform',
      sourceType: 'manual' as const,
      originalFileName: 'Jeremy Smith.md',
      createdAt: '2026-03-25T12:00:00.000Z',
      updatedAt: '2026-03-25T12:00:00.000Z',
    }
    mockGetLatestSourceResume.mockResolvedValue(existingSourceResume)
    await useSourceResumeStore.getState().setLatestSourceResume(existingSourceResume)
    mockUseRouter.mockReturnValue({params: {step: 'jobDescription'}})
    mockChooseMessageFile.mockResolvedValue({
      tempFiles: [
        {
          name: 'jd-shot.png',
          path: '/tmp/jd-shot.png',
          size: 256 * 1024,
        },
      ],
    })

    await renderPage()

    fireEvent.change(screen.getByTestId('job-company-input'), {
      target: {value: '小米集团有限公司'},
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('job-upload-trigger'))
      await jest.runAllTimersAsync()
    })

    await waitFor(() => {
      expect(screen.getByTestId('job-upload-preview')).toBeTruthy()
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('create-flow-primary-action'))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(mockProcessResume).toHaveBeenCalledWith(
        '# Jeremy Smith\n\n## Experience\n- Built growth platform',
        expect.stringContaining('岗位描述附件：jd-shot.png'),
      )
    })

    expect(mockProcessResume).toHaveBeenCalledWith(
      '# Jeremy Smith\n\n## Experience\n- Built growth platform',
      expect.stringContaining('公司名称：小米集团有限公司'),
    )

    await waitFor(() => {
      expect(screen.getByText('开始生成最佳简历')).toBeTruthy()
    })
  })

  test('第二步切到文字输入后应只按手动内容判断和提交', async () => {
    jest.useFakeTimers()
    const existingSourceResume = {
      id: 'source-resume-1',
      title: 'Jeremy Smith',
      resumeMarkdown: '# Jeremy Smith\n\n## Experience\n- Built growth platform',
      sourceType: 'manual' as const,
      originalFileName: 'Jeremy Smith.md',
      createdAt: '2026-03-25T12:00:00.000Z',
      updatedAt: '2026-03-25T12:00:00.000Z',
    }
    mockGetLatestSourceResume.mockResolvedValue(existingSourceResume)
    await useSourceResumeStore.getState().setLatestSourceResume(existingSourceResume)
    mockUseRouter.mockReturnValue({params: {step: 'jobDescription'}})
    mockChooseMessageFile.mockResolvedValue({
      tempFiles: [
        {
          name: 'jd-shot.png',
          path: '/tmp/jd-shot.png',
          size: 256 * 1024,
        },
      ],
    })

    await renderPage()

    await act(async () => {
      fireEvent.click(screen.getByTestId('job-upload-trigger'))
      await jest.runAllTimersAsync()
    })

    await waitFor(() => {
      expect(screen.getByTestId('job-upload-preview')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('job-mode-manual'))

    await act(async () => {
      fireEvent.click(screen.getByTestId('create-flow-primary-action'))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '请先填写目标岗位描述',
          icon: 'none',
        }),
      )
    })

    fireEvent.change(screen.getByTestId('job-description-input'), {
      target: {
        value: '负责 AI 产品设计与跨团队协作，推动复杂功能落地。',
      },
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('create-flow-primary-action'))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(mockProcessResume).toHaveBeenCalled()
    })

    const lastCall = mockProcessResume.mock.calls.at(-1)
    expect(lastCall?.[1]).toContain('负责 AI 产品设计与跨团队协作，推动复杂功能落地。')
    expect(lastCall?.[1]).not.toContain('岗位描述附件：jd-shot.png')
  })

  test('第二步切回图片上传后应只按上传内容判断和提交', async () => {
    jest.useFakeTimers()
    const existingSourceResume = {
      id: 'source-resume-1',
      title: 'Jeremy Smith',
      resumeMarkdown: '# Jeremy Smith\n\n## Experience\n- Built growth platform',
      sourceType: 'manual' as const,
      originalFileName: 'Jeremy Smith.md',
      createdAt: '2026-03-25T12:00:00.000Z',
      updatedAt: '2026-03-25T12:00:00.000Z',
    }
    mockGetLatestSourceResume.mockResolvedValue(existingSourceResume)
    await useSourceResumeStore.getState().setLatestSourceResume(existingSourceResume)
    mockUseRouter.mockReturnValue({params: {step: 'jobDescription'}})
    mockChooseMessageFile.mockResolvedValue({
      tempFiles: [
        {
          name: 'jd-shot.png',
          path: '/tmp/jd-shot.png',
          size: 256 * 1024,
        },
      ],
    })

    await renderPage()

    fireEvent.click(screen.getByTestId('job-mode-manual'))
    fireEvent.change(screen.getByTestId('job-description-input'), {
      target: {
        value: '这段手动输入内容不应该在上传模式下被提交。',
      },
    })

    fireEvent.click(screen.getByTestId('job-mode-upload'))

    await act(async () => {
      fireEvent.click(screen.getByTestId('create-flow-primary-action'))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '请先上传岗位描述截图，或切换到“文字输入”补充岗位描述',
          icon: 'none',
        }),
      )
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('job-upload-trigger'))
      await jest.runAllTimersAsync()
    })

    await waitFor(() => {
      expect(screen.getByTestId('job-upload-preview')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('create-flow-primary-action'))

    await waitFor(() => {
      expect(mockProcessResume).toHaveBeenCalled()
    })

    const lastCall = mockProcessResume.mock.calls.at(-1)
    expect(lastCall?.[1]).toContain('岗位描述附件：jd-shot.png')
    expect(lastCall?.[1]).not.toContain('这段手动输入内容不应该在上传模式下被提交。')
  })

  test('RN 端缺少 chooseMessageFile 时会回退到图片选择器', async () => {
    jest.useFakeTimers()
    const existingSourceResume = {
      id: 'source-resume-1',
      title: 'Jeremy Smith',
      resumeMarkdown: '# Jeremy Smith\n\n## Experience\n- Built growth platform',
      sourceType: 'manual' as const,
      originalFileName: 'Jeremy Smith.md',
      createdAt: '2026-03-25T12:00:00.000Z',
      updatedAt: '2026-03-25T12:00:00.000Z',
    }
    mockGetLatestSourceResume.mockResolvedValue(existingSourceResume)
    await useSourceResumeStore.getState().setLatestSourceResume(existingSourceResume)
    mockUseRouter.mockReturnValue({params: {step: 'jobDescription'}})
    ;(Taro as any).chooseMessageFile = undefined
    mockExpoImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: true,
    })
    mockExpoImagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: 'file:///tmp/jd-shot-rn.png',
          fileName: 'jd-shot-rn.png',
          fileSize: 256 * 1024,
        },
      ],
    })
    mockExpoFileSystem.getInfoAsync.mockResolvedValue({
      exists: true,
      size: 256 * 1024,
    })

    await renderPage()

    await act(async () => {
      fireEvent.click(screen.getByTestId('job-upload-trigger'))
      await jest.runAllTimersAsync()
    })

    await waitFor(() => {
      expect(mockExpoImagePicker.requestMediaLibraryPermissionsAsync).toHaveBeenCalled()
      expect(mockExpoImagePicker.launchImageLibraryAsync).toHaveBeenCalled()
      expect(screen.getByTestId('job-upload-preview')).toBeTruthy()
    })
  })

  test('上传成功后应显示文件状态', async () => {
    jest.useFakeTimers()
    mockChooseMessageFile.mockResolvedValue({
      tempFiles: [
        {
          name: 'Resume_MelvinKuffour.pdf',
          path: '/tmp/Resume_MelvinKuffour.pdf',
          size: 543 * 1024,
        },
      ],
    })

    await renderPage()

    await act(async () => {
      fireEvent.click(screen.getByTestId('resume-upload-trigger'))
      await jest.runAllTimersAsync()
    })

    await waitFor(() => {
      expect(screen.getByTestId('resume-upload-success')).toBeTruthy()
      expect(screen.getByText('Resume_MelvinKuffour.pdf')).toBeTruthy()
      expect(screen.getByText('543 Kb')).toBeTruthy()
    })
  })

  test('非法文件类型应进入失败状态', async () => {
    mockChooseMessageFile.mockResolvedValue({
      tempFiles: [
        {
          name: 'resume.exe',
          path: '/tmp/resume.exe',
          size: 1024,
        },
      ],
    })

    await renderPage()

    fireEvent.click(screen.getByTestId('resume-upload-trigger'))

    await waitFor(() => {
      expect(screen.getByTestId('resume-upload-error')).toBeTruthy()
      expect(screen.getByText('上传失败')).toBeTruthy()
    })
  })

  test('点击关闭按钮会返回上一页', async () => {
    await renderPage()

    fireEvent.click(screen.getByTestId('create-flow-close'))

    expect(mockNavigateBack).toHaveBeenCalled()
  })
})
