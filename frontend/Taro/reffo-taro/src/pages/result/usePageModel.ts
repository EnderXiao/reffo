import {strategyResultExcerpts} from '@/shared/resume-strategy'
import {useEffect, useRef, useState} from 'react'
import Taro from '@tarojs/taro'
import {resumeApi} from '@/services/resume'
import {useHistoryStore} from '@/store/historyStore'
import {
  resumeWorkspaceActions,
  type ActiveGenerationStatus,
} from '@/store/resumeWorkspaceStore'
import type {ProcessResult, ResumeHistory} from '@/types'
import type {HomeCardItem} from '@/components/business/HomeCardDeck/shared'
import {
  getLatestResultSession,
  saveLatestResultSession,
  type LatestResultSession,
  type LatestResultSessionContext,
  type LatestResultSessionProgress,
} from '@/utils/result-session'
import {createHistoryFromResult} from '@/utils/history-helper'
import {feedback} from '@/utils/feedback'
import {markCompleteInitialEntry} from '@/utils/navigation-transition'
import {appendRouteParams, routePaths, usePageRoute, useRouteTransition} from '@/shared/routing'
import {savePendingLandingHistory} from '@/utils/pending-landing-data'
import {useAuthStore} from '@/store/authStore'
import {toHistoryCardItem} from '../index/model/homeCardData'
import {
  generationTasksApi,
  subscribeGenerationTaskEvents,
  type GenerationTask,
} from '@/services/backgroundGeneration'
import {useBackgroundGenerationStore} from '@/store/backgroundGenerationStore'

const DONE_PROGRESS: LatestResultSessionProgress = {
  analysis: 'done',
  matching: 'done',
  optimized: 'done',
  interview: 'done',
}

const PENDING_PROGRESS: LatestResultSessionProgress = {
  analysis: 'pending',
  matching: 'pending',
  optimized: 'pending',
  interview: 'pending',
}

const EMPTY_INTERVIEW = {
  questions: [],
  story_recommendations: [],
  follow_up_questions: [],
}

function normalizeInterviewResult(result: Partial<ProcessResult>) {
  const interview = result.interview ?? EMPTY_INTERVIEW

  return {
    questions: Array.isArray(interview.questions) ? interview.questions : [],
    story_recommendations: Array.isArray(interview.story_recommendations)
      ? interview.story_recommendations
      : [],
    follow_up_questions: Array.isArray(interview.follow_up_questions)
      ? interview.follow_up_questions
      : [],
  }
}

function getDefaultProgress(result: Partial<ProcessResult> | null): LatestResultSessionProgress {
  if (!result) {
    return {...PENDING_PROGRESS}
  }

  return {
    analysis: 'done',
    matching: (result.matching?.match_score ?? 0) > 0 ? 'done' : 'pending',
    optimized: (result.optimized?.optimized_resume ?? '').trim().length > 0 ? 'done' : 'pending',
    interview: normalizeInterviewResult(result).questions.length > 0 ||
      normalizeInterviewResult(result).story_recommendations.length > 0 ||
      normalizeInterviewResult(result).follow_up_questions.length > 0
      ? 'done'
      : 'pending',
  }
}

function getHistoryProgress(history: ResumeHistory): LatestResultSessionProgress {
  if (!history.progress) return {...DONE_PROGRESS}

  return {
    analysis: history.progress.analysis || 'done',
    matching: history.progress.matching || 'done',
    optimized: history.progress.optimized || 'done',
    interview: history.progress.interview || 'done',
  }
}

function getProgressPercent(progress: LatestResultSessionProgress) {
  if (progress.interview === 'done') return 100
  if (progress.optimized === 'done') return 66.667
  if (progress.analysis === 'done') return 33.333
  return 0
}

function getPendingGenerationStage(
  progress: LatestResultSessionProgress,
): ActiveGenerationStatus | null {
  if (progress.analysis === 'failed') return null
  if (progress.matching === 'failed') return null
  if (progress.matching !== 'done') return 'matching'
  if (progress.optimized === 'failed') return null
  if (progress.optimized !== 'done') return 'optimizing'
  if (progress.interview === 'failed') return null
  if (progress.interview !== 'done') return 'interviewing'
  return null
}

function getFailedGenerationStage(
  progress: LatestResultSessionProgress,
): ResultRetryStageKey | null {
  if (progress.analysis === 'failed') return 'analysis'
  if (progress.matching === 'failed' || progress.optimized === 'failed') return 'resume'
  if (progress.interview === 'failed') return 'interview'
  return null
}

function buildFallbackResultFromHistory(history: ResumeHistory): ProcessResult {
  return {
    analysis: {
      quality_score: history.qualityScore,
      strengths: [],
      weaknesses: [],
      suggestions: [],
      capability_summary: '',
      structured_resume: {
        personal_info: {name: history.name},
        education: [],
        experience: [],
        projects: [],
        skills: {hard_skills: [], soft_skills: []},
      },
    },
    matching: {
      match_score: history.matchScore,
      hard_requirements_match: [],
      skill_match: {
        matched_skills: history.tags,
        missing_skills: [],
        match_percentage: history.matchScore,
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
      optimized_resume: history.optimizedContent,
      changes_summary: [],
      improvement_score: 0,
    },
    interview: EMPTY_INTERVIEW,
  }
}

function buildResultFromHistory(history: ResumeHistory): ProcessResult {
  const fallback = buildFallbackResultFromHistory(history)
  const stored = history.processResult
  const storedOptimized = stored?.optimized
  const optimizedContent = history.optimizedContent || storedOptimized?.optimized_resume || ''

  return {
    analysis: stored?.analysis ?? fallback.analysis,
    matching: stored?.matching ?? fallback.matching,
    optimized: {
      ...(storedOptimized ?? fallback.optimized),
      optimized_resume: optimizedContent,
      changes_summary: strategyResultExcerpts(storedOptimized?.strategy_review, optimizedContent),
    },
    interview: normalizeInterviewResult(stored ?? {}),
  }
}

function buildContextFromHistory(history: ResumeHistory): LatestResultSessionContext {
  return history.resultContext ?? {
    company: history.company,
    position: history.position,
    resumeContent: history.resumeContent,
    jdContent: history.jdContent,
  }
}

function getTaskGenerationStatus(task: GenerationTask): ActiveGenerationStatus {
  if (task.stage === 'analysis') return 'analyzing'
  if (task.stage === 'matching') return 'matching'
  if (task.stage === 'optimized') return 'optimizing'
  return 'interviewing'
}

function getTaskProgressKey(task: GenerationTask): keyof LatestResultSessionProgress {
  if (task.stage === 'analysis') return 'analysis'
  if (task.stage === 'matching') return 'matching'
  if (task.stage === 'optimized') return 'optimized'
  return 'interview'
}

function syncWorkspaceResult(result: ProcessResult, context?: LatestResultSessionContext | null) {
  resumeWorkspaceActions.setAnalysis(result.analysis)
  resumeWorkspaceActions.setMatching(result.matching)
  resumeWorkspaceActions.setOptimizedResume(result.optimized)
  resumeWorkspaceActions.setInterview(normalizeInterviewResult(result))
  if (context?.resumeContent) resumeWorkspaceActions.setSourceResume(context.resumeContent)
  if (context?.jdContent) resumeWorkspaceActions.setJobDescription(context.jdContent)
}

export interface ResultPageViewModel {
  result: ProcessResult | null
  resumeContent: string
  jdContent: string
  companyName: string
  positionName: string
  loading: boolean
  saved: boolean
  isCompleting: boolean
  progress: LatestResultSessionProgress
  progressPercent: number
  generationError: string | null
  enteredFromCard: boolean
  enteredFromLanding: boolean
  returnCard: HomeCardItem | null
  handleSave: () => Promise<string | null>
  handleComplete: () => Promise<void>
  handleShare: () => Promise<void>
  handleBackHome: () => Promise<void>
  handleEditHistory: () => Promise<void>
  handlePendingStage: () => void
  handleRetryStage: (stage: ResultRetryStageKey) => Promise<void>
  handleOptimizedResumeChange: (markdown: string) => Promise<void>
  canEditHistory: boolean
  needsCompletion?: boolean
}

export type ResultRetryStageKey = 'analysis' | 'resume' | 'interview'

interface ResultPageModelOptions {
  enteredFromLanding?: boolean
  initialSession?: LatestResultSession
}

export function usePageModel(options: ResultPageModelOptions = {}): ResultPageViewModel {
  const pageRoute = usePageRoute()
  const route = useRouteTransition()
  const {addHistory} = useHistoryStore()
  const enteredFromCard = pageRoute.readBoolean('fromCard')
  const resultId = pageRoute.readString('id')
  const generationJobId = pageRoute.readString('jobId')
  const [needsCompletion, setNeedsCompletion] = useState(Boolean(generationJobId))
  const enteredFromLanding = options.enteredFromLanding === true
  const initialSessionRef = useRef<LatestResultSession | null>(options.initialSession
    ? {
        ...options.initialSession,
        result: {
          ...options.initialSession.result,
          interview: normalizeInterviewResult(options.initialSession.result),
        },
        progress: {
          ...getDefaultProgress(options.initialSession.result),
          ...options.initialSession.progress,
          interview: options.initialSession.progress?.interview
            ?? getDefaultProgress(options.initialSession.result).interview,
        },
      }
    : null)
  const resultRef = useRef<ProcessResult | null>(initialSessionRef.current?.result ?? null)
  const latestSessionRef = useRef<LatestResultSession | null>(initialSessionRef.current)
  const sessionWriteQueueRef = useRef<Promise<void>>(Promise.resolve())
  const [result, setResultState] = useState<ProcessResult | null>(
    () => initialSessionRef.current?.result ?? null,
  )
  const setResult = (nextResult: ProcessResult | null) => {
    resultRef.current = nextResult
    setResultState(nextResult)
  }
  const [resultContext, setResultContext] =
    useState<LatestResultSessionContext | null>(() => initialSessionRef.current?.context ?? null)
  const [loading, setLoading] = useState(() => !initialSessionRef.current)
  const [saved, setSaved] = useState(false)
  const [isCompleting, setIsCompleting] = useState(false)
  const [savedHistoryId, setSavedHistoryId] = useState<string | null>(
    resultId,
  )
  const [progress, setProgress] = useState<LatestResultSessionProgress>(
    () => initialSessionRef.current?.progress ?? getDefaultProgress(null),
  )
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [returnCard, setReturnCard] = useState<HomeCardItem | null>(null)
  const continuationRef = useRef(0)
  const workspaceGenerationRunRef = useRef<number | null>(null)
  const isContinuingRef = useRef(false)
  const generationJobUnsubscribeRef = useRef<(() => void) | null>(null)
  const generationJobReadRef = useRef(false)
  const generationTaskUpdatedAtRef = useRef('')
  const historyRefreshQueueRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => () => {
    continuationRef.current += 1
    generationJobUnsubscribeRef.current?.()
    generationJobUnsubscribeRef.current = null
    if (workspaceGenerationRunRef.current != null) {
      resumeWorkspaceActions.cancelGeneration(workspaceGenerationRunRef.current)
      workspaceGenerationRunRef.current = null
    }
  }, [])

  useEffect(() => {
    const initialSession = initialSessionRef.current

    if (initialSession) {
      initialSessionRef.current = null
      void continueLatestSession(initialSession)
      return
    }

    if (resultId) {
      generationJobUnsubscribeRef.current?.()
      generationJobUnsubscribeRef.current = null
      void loadFromHistory(resultId)
      return
    }

    void loadFromLatestSession()
  }, [resultId])

  const applyHistorySnapshot = (history: ResumeHistory) => {
    const processResult = buildResultFromHistory(history)
    const historyProgress = getHistoryProgress(history)
    const context = buildContextFromHistory(history)
    const displayHistory: ResumeHistory = {
      ...history,
      optimizedContent: processResult.optimized.optimized_resume,
      processResult,
    }

    setReturnCard(toHistoryCardItem(displayHistory))
    latestSessionRef.current = {
      result: processResult,
      context,
      progress: historyProgress,
    }
    setResult(processResult)
    setResultContext(context)
    syncWorkspaceResult(processResult, context)
    setProgress(historyProgress)
    setSaved(true)
    setSavedHistoryId(history.id)
  }

  const refreshHistorySnapshot = (id: string) => {
    const refresh = historyRefreshQueueRef.current.catch(() => undefined).then(async () => {
      const history = await useHistoryStore.getState().loadHistory(id, {force: true})
      if (history) applyHistorySnapshot(history)
    })
    historyRefreshQueueRef.current = refresh.then(() => undefined, () => undefined)
    return refresh
  }

  const syncGenerationTaskWorkspace = (task: GenerationTask) => {
    if (task.status === 'completed') {
      resumeWorkspaceActions.markGenerationCompleted()
      workspaceGenerationRunRef.current = null
      return
    }

    if (task.status === 'failed' || task.status === 'cancelled') {
      if (workspaceGenerationRunRef.current != null) {
        if (task.status === 'failed') {
          resumeWorkspaceActions.failGeneration(
            workspaceGenerationRunRef.current,
            task.error || '生成失败，请重试',
          )
        } else {
          resumeWorkspaceActions.cancelGeneration(workspaceGenerationRunRef.current)
        }
        workspaceGenerationRunRef.current = null
      }
      return
    }

    const nextStatus = getTaskGenerationStatus(task)
    if (workspaceGenerationRunRef.current == null) {
      workspaceGenerationRunRef.current = resumeWorkspaceActions.startGeneration(nextStatus)
    } else {
      resumeWorkspaceActions.transitionGeneration(workspaceGenerationRunRef.current, nextStatus)
    }
  }

  const consumeGenerationTask = async (task: GenerationTask, historyId: string) => {
    if (task.id !== generationJobId || task.updated_at < generationTaskUpdatedAtRef.current) return
    generationTaskUpdatedAtRef.current = task.updated_at
    useBackgroundGenerationStore.getState().upsert(task)

    if (task.history_id && task.history_id !== historyId) {
      setNeedsCompletion(false)
      return
    }

    syncGenerationTaskWorkspace(task)
    if (task.status === 'running' || task.status === 'completed') {
      await refreshHistorySnapshot(historyId)
    }

    if (task.status === 'failed') {
      const error = task.error || '生成失败，请重试'
      const progressKey = getTaskProgressKey(task)
      setGenerationError(error)
      setProgress(current => ({...current, [progressKey]: 'failed'}))
      setNeedsCompletion(false)
      return
    }

    if (task.status === 'cancelled') {
      setGenerationError('生成已取消')
      setNeedsCompletion(false)
      return
    }

    if (task.status === 'completed') {
      setGenerationError(null)
      setNeedsCompletion(!task.confirmed_at)
      if (!task.read_at && !generationJobReadRef.current) {
        generationJobReadRef.current = true
        try {
          const updated = await generationTasksApi.action(generationJobId!, 'read')
          useBackgroundGenerationStore.getState().upsert(updated)
        } catch {
          generationJobReadRef.current = false
          feedback.message('已读状态暂未同步，稍后可重试')
        }
      }
    }
  }

  const watchGenerationJob = async (historyId: string) => {
    if (!generationJobId) return
    const consume = (task: GenerationTask) => {
      void consumeGenerationTask(task, historyId).catch(error => {
        console.error('同步后台生成进度失败:', error)
      })
    }

    try {
      consume(await generationTasksApi.get(generationJobId))
    } catch (error) {
      console.error('获取后台生成任务失败:', error)
    }

    const unsubscribe = subscribeGenerationTaskEvents({
      onTask: consume,
      onOpen: () => {
        void generationTasksApi.get(generationJobId).then(consume).catch(error => {
          console.error('校准后台生成任务失败:', error)
        })
      },
    })

    // 手机 Safari 等环境 SSE 可能断流：轮询兜底，保证结果页后续阶段进度自己推进。
    let stopped = false
    const stop = () => {
      stopped = true
      clearInterval(pollTimer)
    }
    const pollTimer = setInterval(() => {
      if (stopped) return
      generationTasksApi.get(generationJobId).then(task => {
        if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
          stop()
        }
        consume(task)
      }).catch(() => undefined)
    }, 3000)

    generationJobUnsubscribeRef.current?.()
    generationJobUnsubscribeRef.current = () => {
      unsubscribe()
      stop()
    }
  }

  const loadFromHistory = async (id: string) => {
    try {
      // 后台任务保存 history 与推送任务事件之间存在微小窗口，弱网下首次
      // 请求也可能瞬断；失败时短间隔重试，避免误判成「未找到结果」。
      let history = await useHistoryStore.getState().loadHistory(id, {force: true})
      for (let attempt = 1; !history && attempt <= 2; attempt += 1) {
        console.warn(`[result] loadHistory 重试 ${attempt}/2`, {id, jobId: generationJobId})
        await new Promise(resolve => setTimeout(resolve, 400))
        history = await useHistoryStore.getState().loadHistory(id, {force: true})
      }

      if (history) {
        applyHistorySnapshot(history)
        if (generationJobId) {
          await watchGenerationJob(id)
        } else {
          resumeWorkspaceActions.markGenerationCompleted()
        }
      } else {
        console.warn('[result] loadHistory 重试后仍为空，判定未找到结果', {id, jobId: generationJobId})
        feedback.message('未找到结果')
        void route.reset(routePaths.home)
      }
    } catch (error) {
      console.error('加载历史记录失败:', error)
      feedback.error('加载失败')
    } finally {
      setLoading(false)
    }
  }

  const loadFromLatestSession = async () => {
    try {
      const session = await getLatestResultSession()

      if (session) {
        const sessionProgress = {
          ...getDefaultProgress(session.result),
          ...session.progress,
          interview: session.progress?.interview ?? getDefaultProgress(session.result).interview,
        }
        const sessionResult = {
          ...session.result,
          interview: normalizeInterviewResult(session.result),
        }
        const nextSession = {
          ...session,
          result: sessionResult,
          progress: sessionProgress,
        }
        latestSessionRef.current = nextSession
        setResult(sessionResult)
        setResultContext(session.context)
        syncWorkspaceResult(sessionResult, session.context)
        setReturnCard(null)
        setProgress(sessionProgress)
        void continueLatestSession(nextSession)
      } else {
        // Taro H5 首帧 URL 可能尚未更新，pageRoute 捕获的 params 缺 id，
        // 导致误走本分支：短暂等待后从 window.location 重读 history id，
        // 有则改走 history 加载，避免「未找到结果」闪现与误 reset。
        await new Promise(resolve => setTimeout(resolve, 400))
        if (resultRef.current) return
        const hash = typeof window !== 'undefined' ? (window.location.hash || '') : ''
        const queryIndex = hash.indexOf('?')
        const hashId = queryIndex >= 0
          ? (new URLSearchParams(hash.slice(queryIndex + 1)).get('id') || null)
          : null
        if (hashId) {
          console.warn('[result] session 为空但 URL 已有 history id，改走 history 加载', hashId)
          await loadFromHistory(hashId)
          return
        }
        feedback.message('未找到结果')
        void route.reset(routePaths.home)
      }
    } catch (error) {
      console.error('加载结果失败:', error)
      feedback.error('加载失败')
    } finally {
      setLoading(false)
    }
  }

  const queueSessionSave = (nextSession: LatestResultSession) => {
    const write = sessionWriteQueueRef.current
      .catch(() => undefined)
      .then(() => saveLatestResultSession(nextSession))
    sessionWriteQueueRef.current = write.then(() => undefined, () => undefined)
    return write
  }

  const persistSession = async (
    session: LatestResultSession,
    nextResult: ProcessResult,
    nextProgress: LatestResultSessionProgress,
  ) => {
    const nextSession: LatestResultSession = {
      ...(latestSessionRef.current ?? session),
      result: nextResult,
      progress: nextProgress,
    }

    latestSessionRef.current = nextSession
    await queueSessionSave(nextSession)
    setResult(nextResult)
    setProgress(nextProgress)
    syncWorkspaceResult(nextResult, nextSession.context)

    return nextSession
  }

  const continueLatestSession = async (session: LatestResultSession) => {
    if (isContinuingRef.current) return

    const runId = continuationRef.current + 1
    continuationRef.current = runId
    isContinuingRef.current = true

    let currentSession = latestSessionRef.current ?? session
    let currentResult = currentSession.result
    let currentProgress = currentSession.progress || getDefaultProgress(currentSession.result)
    const initialStage = getPendingGenerationStage(currentProgress)

    if (!initialStage) {
      if (!getFailedGenerationStage(currentProgress)) {
        resumeWorkspaceActions.markGenerationCompleted()
      }
      isContinuingRef.current = false
      return
    }

    const workspaceRunId = resumeWorkspaceActions.startGeneration(initialStage)
    workspaceGenerationRunRef.current = workspaceRunId
    let workspaceStage = initialStage
    const transitionWorkspace = (nextStage: ActiveGenerationStatus) => {
      if (workspaceStage === nextStage) return
      if (resumeWorkspaceActions.transitionGeneration(workspaceRunId, nextStage)) {
        workspaceStage = nextStage
      }
    }

    try {
      setGenerationError(null)

      if (currentProgress.matching !== 'done') {
        const generatingProgress: LatestResultSessionProgress = {
          ...currentProgress,
          matching: 'generating',
        }
        currentProgress = generatingProgress
        setProgress(generatingProgress)

        const matching = await resumeApi.matchResume(
          currentResult.analysis,
          enteredFromLanding && currentSession.context.presetJdId
            ? {presetJdId: currentSession.context.presetJdId}
            : currentSession.context.jdContent,
          {landing: enteredFromLanding},
        )

        if (continuationRef.current !== runId) return

        currentResult = {
          ...currentResult,
          matching,
        }
        currentProgress = {
          ...generatingProgress,
          matching: 'done',
        }
        currentSession = await persistSession(
          currentSession,
          currentResult,
          currentProgress,
        )
      }

      if (currentProgress.optimized !== 'done') {
        transitionWorkspace('optimizing')
        const generatingProgress: LatestResultSessionProgress = {
          ...currentProgress,
          optimized: 'generating',
        }
        currentProgress = generatingProgress
        setProgress(generatingProgress)

        const optimized = await resumeApi.generateOptimizedResume(
          currentResult.analysis,
          currentResult.matching,
          ...(enteredFromLanding
            ? [{landing: true, presetJdId: currentSession.context.presetJdId}]
            : []),
        )

        if (continuationRef.current !== runId) return

        currentResult = {
          ...currentResult,
          optimized,
        }
        currentProgress = {
          ...generatingProgress,
          optimized: 'done',
        }
        currentSession = await persistSession(currentSession, currentResult, currentProgress)
      }

      if (currentProgress.interview !== 'done') {
        transitionWorkspace('interviewing')
        const generatingProgress: LatestResultSessionProgress = {
          ...currentProgress,
          interview: 'generating',
        }
        currentProgress = generatingProgress
        setProgress(generatingProgress)

        currentResult = resultRef.current ?? currentResult
        currentSession = {...currentSession, result: currentResult}

        const interview = await resumeApi.generateInterviewSuggestions(
          currentResult.analysis,
          currentResult.matching,
          currentResult.optimized,
          ...(enteredFromLanding
            ? [{landing: true, presetJdId: currentSession.context.presetJdId}]
            : []),
        )

        if (continuationRef.current !== runId) return

        const latestResult = resultRef.current ?? currentResult
        currentResult = {
          ...latestResult,
          interview,
        }
        currentProgress = {
          ...(latestSessionRef.current?.progress ?? generatingProgress),
          interview: 'done',
        }
        await persistSession(
          {...(latestSessionRef.current ?? currentSession), result: currentResult},
          currentResult,
          currentProgress,
        )
      }
      resumeWorkspaceActions.completeGeneration(workspaceRunId)
    } catch (error) {
      if (continuationRef.current !== runId) return

      const message = error instanceof Error ? error.message : '生成失败，请重试'
      resumeWorkspaceActions.failGeneration(workspaceRunId, message)
      console.error('continue result generation failed', error)
      setGenerationError(message)
      const failedProgress: LatestResultSessionProgress = {
        ...currentProgress,
        matching: currentProgress.matching === 'generating' ? 'failed' : currentProgress.matching,
        optimized: currentProgress.optimized === 'generating' ? 'failed' : currentProgress.optimized,
        interview: currentProgress.interview === 'generating' ? 'failed' : currentProgress.interview,
      }
      const failedSession: LatestResultSession = {
        ...(latestSessionRef.current ?? currentSession),
        result: currentResult,
        progress: failedProgress,
      }
      latestSessionRef.current = failedSession
      setProgress(failedProgress)
      void queueSessionSave(failedSession).catch(saveError => {
        console.warn('failed to persist result generation failure', saveError)
      })
    } finally {
      if (continuationRef.current === runId) {
        isContinuingRef.current = false
        workspaceGenerationRunRef.current = null
      } else {
        resumeWorkspaceActions.cancelGeneration(workspaceRunId)
      }
    }
  }

  const saveCurrentResult = async (showFeedback = true) => {
    if (!result) return savedHistoryId

    if (saved) return savedHistoryId

    if (progress.interview !== 'done') {
      feedback.message('正在生成中，请稍后')
      return null
    }

    try {
      const baseHistory = createHistoryFromResult(
        result,
        resultContext?.resumeContent || '',
        resultContext?.jdContent || '',
      )
      const resolvedCompany = resultContext?.company.trim() || baseHistory.company
      const resolvedPosition = resultContext?.position.trim() || baseHistory.position
      const resolvedLocation =
        resultContext?.location?.trim() ||
        baseHistory.resultContext?.location?.trim() ||
        ''

      const history = {
        ...baseHistory,
        position: resolvedPosition,
        company: resolvedCompany,
        processResult: result,
        resultContext: {
          company: resolvedCompany,
          position: resolvedPosition,
          ...(resolvedLocation ? {location: resolvedLocation} : {}),
          resumeContent: resultContext?.resumeContent || baseHistory.resumeContent,
          jdContent: resultContext?.jdContent || baseHistory.jdContent,
          ...(resultContext?.presetJdId ? {presetJdId: resultContext.presetJdId} : {}),
        },
        progress,
      }
      const historyId = savedHistoryId
        ? (await useHistoryStore.getState().updateHistory(savedHistoryId, history), savedHistoryId)
        : enteredFromLanding && !useAuthStore.getState().session
        ? await savePendingLandingHistory(history)
        : await addHistory(history)

      setSaved(true)
      setSavedHistoryId(historyId)
      if (showFeedback) {
        feedback.success('保存成功')
      }

      return historyId
    } catch (error) {
      console.error('保存失败:', error)
      feedback.error('保存失败')
      return null
    }
  }

  const handleSave = async () => saveCurrentResult(true)

  const handleComplete = async () => {
    if (isCompleting) {
      return
    }

    if (progress.interview !== 'done') {
      feedback.message('正在生成中，请稍后')
      return
    }

    setIsCompleting(true)
    try {
      const historyId = await saveCurrentResult(false)

      if (!historyId) {
        return
      }
      if (generationJobId && needsCompletion) {
        try {
          const task = await generationTasksApi.action(generationJobId, 'confirm')
          useBackgroundGenerationStore.getState().upsert(task)
        } catch (confirmError) {
          console.error('confirm generation task failed:', confirmError)
          feedback.message('任务状态确认失败，请在首页重新查看')
          return
        }
      }

      continuationRef.current += 1
      if (workspaceGenerationRunRef.current != null) {
        resumeWorkspaceActions.cancelGeneration(workspaceGenerationRunRef.current)
        workspaceGenerationRunRef.current = null
      }
      markCompleteInitialEntry()
      await route.navigate(appendRouteParams(routePaths.complete, {historyId}))
    } catch (error) {
      feedback.error(error instanceof Error ? error.message : '完成失败，请重试')
    } finally {
      setIsCompleting(false)
    }
  }

  const handleShare = async () => {
    try {
      await Taro.showShareMenu({withShareTicket: true})
    } catch (error) {
      console.error('分享失败:', error)
      feedback.message('分享功能暂不可用')
    }
  }

  const handleBackHome = () => {
    continuationRef.current += 1
    if (workspaceGenerationRunRef.current != null) {
      resumeWorkspaceActions.cancelGeneration(workspaceGenerationRunRef.current)
      workspaceGenerationRunRef.current = null
    }
    if (enteredFromCard) {
      return route.reset(routePaths.home)
    }

    return route.reset(routePaths.home)
  }

  const handleEditHistory = async () => {
    if (!savedHistoryId) {
      feedback.message('当前简历还未保存，暂不能编辑')
      return
    }

    continuationRef.current += 1
    if (workspaceGenerationRunRef.current != null) {
      resumeWorkspaceActions.cancelGeneration(workspaceGenerationRunRef.current)
      workspaceGenerationRunRef.current = null
    }
    await route.navigate(routePaths.create, {
      step: 'jobDescription',
      mode: 'editHistory',
      historyId: savedHistoryId,
    })
  }

  const handlePendingStage = () => {
    feedback.message(generationError || '正在生成中，请稍后')
  }

  const handleRetryStage = async (stage: ResultRetryStageKey) => {
    if (!result) {
      feedback.message('未找到可重试的生成结果')
      return
    }

    const failedStage = stage === 'analysis'
      ? progress.analysis === 'failed'
      : stage === 'resume'
        ? progress.matching === 'failed' || progress.optimized === 'failed'
        : progress.interview === 'failed'

    if (!failedStage) {
      handlePendingStage()
      return
    }

    if (!resultContext) {
      feedback.message('缺少简历或岗位信息，无法重试')
      return
    }

    const retryProgress: LatestResultSessionProgress = {...progress}
    if (stage === 'analysis') {
      retryProgress.analysis = 'pending'
    } else if (stage === 'resume') {
      if (retryProgress.matching === 'failed') retryProgress.matching = 'pending'
      if (retryProgress.optimized === 'failed') retryProgress.optimized = 'pending'
    } else {
      retryProgress.interview = 'pending'
    }

    const retrySession: LatestResultSession = {
      ...(latestSessionRef.current ?? {context: resultContext}),
      context: resultContext,
      result,
      progress: retryProgress,
    }
    latestSessionRef.current = retrySession
    await continueLatestSession(retrySession)
  }

  const handleOptimizedResumeChange = async (markdown: string) => {
    const currentResult = resultRef.current ?? result
    if (!currentResult) return

    const nextResult: ProcessResult = {
      ...currentResult,
      optimized: {
        ...currentResult.optimized,
        optimized_resume: markdown,
        changes_summary: strategyResultExcerpts(currentResult.optimized.strategy_review, markdown),
      },
    }

    setResult(nextResult)
    syncWorkspaceResult(nextResult, resultContext)
    setSaved(false)

    const context = latestSessionRef.current?.context ?? resultContext
    if (!context) return

    const nextSession: LatestResultSession = {
      ...(latestSessionRef.current ?? {context, result: nextResult}),
      context,
      result: nextResult,
      progress: latestSessionRef.current?.progress ?? progress,
    }
    latestSessionRef.current = nextSession
    await queueSessionSave(nextSession)
  }

  return {
    result,
    resumeContent: resultContext?.resumeContent || '',
    jdContent: resultContext?.jdContent || '',
    companyName: resultContext?.company || '',
    positionName: resultContext?.position || '',
    loading,
    saved,
    isCompleting,
    progress,
    progressPercent: getProgressPercent(progress),
    generationError,
    enteredFromCard,
    enteredFromLanding,
    returnCard,
    canEditHistory: Boolean(savedHistoryId),
    needsCompletion,
    handleSave,
    handleComplete,
    handleShare,
    handleBackHome,
    handleEditHistory,
    handlePendingStage,
    handleRetryStage,
    handleOptimizedResumeChange,
  }
}
