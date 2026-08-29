import {beforeEach, describe, expect, test} from '@jest/globals'
import {useResumeWorkspaceStore} from '../resumeWorkspaceStore'

describe('resumeWorkspaceStore', () => {
  beforeEach(() => {
    useResumeWorkspaceStore.getState().reset()
  })

  test('统一维护简历工作区数据并完整重置', () => {
    const store = useResumeWorkspaceStore.getState()

    store.setSourceResume('source resume')
    store.setJobDescription('job description')
    store.setAnalysis({quality_score: 88} as never)
    store.setMatching({match_score: 91} as never)
    store.setOptimizedResume({optimized_resume: 'optimized'} as never)
    store.setInterview({questions: []} as never)

    useResumeWorkspaceStore.getState().reset()

    expect(useResumeWorkspaceStore.getState()).toMatchObject({
      sourceResume: '',
      jobDescription: '',
      analysis: null,
      matching: null,
      optimizedResume: null,
      interview: null,
      generationStatus: 'idle',
      error: null,
    })
  })

  test('生成状态只能按阶段向前迁移', () => {
    const runId = useResumeWorkspaceStore.getState().startGeneration()

    expect(useResumeWorkspaceStore.getState().generationStatus).toBe('analyzing')
    expect(useResumeWorkspaceStore.getState().transitionGeneration(runId, 'optimizing')).toBe(false)
    expect(useResumeWorkspaceStore.getState().transitionGeneration(runId, 'matching')).toBe(true)
    expect(useResumeWorkspaceStore.getState().transitionGeneration(runId, 'optimizing')).toBe(true)
    expect(useResumeWorkspaceStore.getState().transitionGeneration(runId, 'interviewing')).toBe(true)
    expect(useResumeWorkspaceStore.getState().completeGeneration(runId)).toBe(true)
    expect(useResumeWorkspaceStore.getState().generationStatus).toBe('completed')
  })

  test('新请求开始后旧请求不能覆盖状态', () => {
    const firstRunId = useResumeWorkspaceStore.getState().startGeneration()
    const secondRunId = useResumeWorkspaceStore.getState().startGeneration('matching')

    expect(useResumeWorkspaceStore.getState().failGeneration(firstRunId, '旧请求失败')).toBe(false)
    expect(useResumeWorkspaceStore.getState().cancelGeneration(firstRunId)).toBe(false)
    expect(useResumeWorkspaceStore.getState()).toMatchObject({
      generationRunId: secondRunId,
      generationStatus: 'matching',
      error: null,
    })
  })

  test('取消请求回到 idle 并让晚到结果失效', () => {
    const runId = useResumeWorkspaceStore.getState().startGeneration('optimizing')

    expect(useResumeWorkspaceStore.getState().cancelGeneration(runId)).toBe(true)
    expect(useResumeWorkspaceStore.getState()).toMatchObject({
      generationStatus: 'idle',
      error: null,
    })
    expect(useResumeWorkspaceStore.getState().transitionGeneration(runId, 'interviewing')).toBe(false)
  })

  test('失败状态保留当前请求错误且重试会清理错误', () => {
    const failedRunId = useResumeWorkspaceStore.getState().startGeneration()

    expect(useResumeWorkspaceStore.getState().failGeneration(failedRunId, '分析失败')).toBe(true)
    expect(useResumeWorkspaceStore.getState()).toMatchObject({
      generationStatus: 'failed',
      error: '分析失败',
    })

    const retryRunId = useResumeWorkspaceStore.getState().startGeneration()
    expect(retryRunId).toBeGreaterThan(failedRunId)
    expect(useResumeWorkspaceStore.getState()).toMatchObject({
      generationStatus: 'analyzing',
      error: null,
    })
  })

  test('重置会使执行中的请求失效', () => {
    const runId = useResumeWorkspaceStore.getState().startGeneration()

    useResumeWorkspaceStore.getState().reset()

    expect(useResumeWorkspaceStore.getState().generationStatus).toBe('idle')
    expect(useResumeWorkspaceStore.getState().failGeneration(runId, '晚到错误')).toBe(false)
  })
})
