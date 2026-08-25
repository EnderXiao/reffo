import {useEffect, useRef, useState} from 'react'
import Taro, {useRouter} from '@tarojs/taro'
import {resumeApi} from '@/services/resume'
import {useHistoryStore} from '@/store/historyStore'
import {resumeWorkspaceActions} from '@/store/resumeWorkspaceStore'
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
import {appendRouteParams, routePaths, useRouteTransition} from '@/shared/routing'
import {savePendingLandingHistory} from '@/utils/pending-landing-data'
import {useAuthStore} from '@/store/authStore'
import {toHistoryCardItem} from '../index/model/homeCardData'

const DONE_PROGRESS: LatestResultSessionProgress = {
  analysis: 'done',
  matching: 'done',
  optimized: 'done',
  interview: 'done',
}

const EMPTY_INTERVIEW = {
  questions: [],
  story_recommendations: [],
  follow_up_questions: [],
}

function normalizeInterviewResult(result: ProcessResult) {
  const interview = result.interview

  return {
    questions: Array.isArray(interview?.questions) ? interview.questions : [],
    story_recommendations: Array.isArray(interview?.story_recommendations)
      ? interview.story_recommendations
      : [],
    follow_up_questions: Array.isArray(interview?.follow_up_questions)
      ? interview.follow_up_questions
      : [],
  }
}

function getDefaultProgress(result: ProcessResult | null): LatestResultSessionProgress {
  if (!result) {
    return {
      analysis: 'pending',
      matching: 'pending',
      optimized: 'pending',
      interview: 'pending',
    }
  }

  return {
    analysis: 'done',
    matching: result.matching.match_score > 0 ? 'done' : 'pending',
    optimized: result.optimized.optimized_resume.trim().length > 0 ? 'done' : 'pending',
    interview: normalizeInterviewResult(result).questions.length > 0 ||
      normalizeInterviewResult(result).story_recommendations.length > 0 ||
      normalizeInterviewResult(result).follow_up_questions.length > 0
      ? 'done'
      : 'pending',
  }
}

function getProgressPercent(progress: LatestResultSessionProgress) {
  if (progress.interview === 'done') return 100
  if (progress.optimized === 'done') return 66.667
  if (progress.analysis === 'done') return 33.333
  return 0
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

function buildContextFromHistory(history: ResumeHistory): LatestResultSessionContext {
  return history.resultContext ?? {
    company: history.company,
    position: history.position,
    resumeContent: history.resumeContent,
    jdContent: history.jdContent,
  }
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
  loading: boolean
  saved: boolean
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
  handleOptimizedResumeChange: (markdown: string) => Promise<void>
  canEditHistory: boolean
}

interface ResultPageModelOptions {
  enteredFromLanding?: boolean
  initialSession?: LatestResultSession
}

export function usePageModel(options: ResultPageModelOptions = {}): ResultPageViewModel {
  const router = useRouter()
  const route = useRouteTransition()
  const {addHistory} = useHistoryStore()
  const enteredFromCard = router.params.fromCard === '1'
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
  const [result, setResult] = useState<ProcessResult | null>(
    () => initialSessionRef.current?.result ?? null,
  )
  const [resultContext, setResultContext] =
    useState<LatestResultSessionContext | null>(() => initialSessionRef.current?.context ?? null)
  const [loading, setLoading] = useState(() => !initialSessionRef.current)
  const [saved, setSaved] = useState(false)
  const [savedHistoryId, setSavedHistoryId] = useState<string | null>(
    typeof router.params.id === 'string' ? router.params.id : null,
  )
  const [progress, setProgress] = useState<LatestResultSessionProgress>(
    () => initialSessionRef.current?.progress ?? getDefaultProgress(null),
  )
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [returnCard, setReturnCard] = useState<HomeCardItem | null>(null)
  const continuationRef = useRef(0)
  const isContinuingRef = useRef(false)

  useEffect(() => {
    const initialSession = initialSessionRef.current

    if (initialSession) {
      initialSessionRef.current = null
      void continueLatestSession(initialSession)
      return
    }

    const resultId = router.params.id

    if (resultId) {
      void loadFromHistory(resultId)
      return
    }

    void loadFromLatestSession()
  }, [router.params.id])

  const loadFromHistory = async (id: string) => {
    try {
      let {histories} = useHistoryStore.getState()
      let history = histories.find(item => item.id === id)

      if (!history) {
        await useHistoryStore.getState().loadHistories()
        histories = useHistoryStore.getState().histories
        history = histories.find(item => item.id === id)
      }

      if (history) {
        setReturnCard(toHistoryCardItem(history))
        const processResult: ProcessResult = history.processResult
          ? {
            ...history.processResult,
            interview: normalizeInterviewResult(history.processResult),
          }
          : buildFallbackResultFromHistory(history)
        const historyProgress = {
          ...DONE_PROGRESS,
          ...history.progress,
        }

        const context = buildContextFromHistory(history)
        setResult(processResult)
        setResultContext(context)
        syncWorkspaceResult(processResult, context)
        setProgress(historyProgress)
        setSaved(true)
        setSavedHistoryId(id)
      } else {
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
        setResult(sessionResult)
        setResultContext(session.context)
        syncWorkspaceResult(sessionResult, session.context)
        setReturnCard(null)
        setProgress(sessionProgress)
        void continueLatestSession({
          ...session,
          result: sessionResult,
          progress: sessionProgress,
        })
      } else {
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

  const persistSession = async (
    session: LatestResultSession,
    nextResult: ProcessResult,
    nextProgress: LatestResultSessionProgress,
  ) => {
    const nextSession: LatestResultSession = {
      ...session,
      result: nextResult,
      progress: nextProgress,
    }

    await saveLatestResultSession(nextSession)
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

    let currentSession = session
    let currentResult = session.result
    let currentProgress = session.progress || getDefaultProgress(session.result)

    try {
      setGenerationError(null)

      if (currentProgress.matching !== 'done') {
        const generatingProgress: LatestResultSessionProgress = {
          ...currentProgress,
          matching: 'generating',
        }
        setProgress(generatingProgress)

        const matching = await resumeApi.matchResume(
          currentResult.analysis,
          enteredFromLanding && currentSession.context.presetJdId
            ? {presetJdId: currentSession.context.presetJdId}
            : currentSession.context.jdContent,
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
        const generatingProgress: LatestResultSessionProgress = {
          ...currentProgress,
          optimized: 'generating',
        }
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
        const generatingProgress: LatestResultSessionProgress = {
          ...currentProgress,
          interview: 'generating',
        }
        setProgress(generatingProgress)

        const interview = await resumeApi.generateInterviewSuggestions(
          currentResult.analysis,
          currentResult.matching,
          currentResult.optimized,
          ...(enteredFromLanding
            ? [{landing: true, presetJdId: currentSession.context.presetJdId}]
            : []),
        )

        if (continuationRef.current !== runId) return

        currentResult = {
          ...currentResult,
          interview,
        }
        currentProgress = {
          ...generatingProgress,
          interview: 'done',
        }
        await persistSession(currentSession, currentResult, currentProgress)
      }
    } catch (error) {
      if (continuationRef.current !== runId) return

      const message = error instanceof Error ? error.message : '生成失败，请重试'
      console.error('continue result generation failed', error)
      setGenerationError(message)
      setProgress({
        ...currentProgress,
        matching: currentProgress.matching === 'generating' ? 'failed' : currentProgress.matching,
        optimized: currentProgress.optimized === 'generating' ? 'failed' : currentProgress.optimized,
        interview: currentProgress.interview === 'generating' ? 'failed' : currentProgress.interview,
      })
      feedback.error(message)
    } finally {
      if (continuationRef.current === runId) {
        isContinuingRef.current = false
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
      const historyId = enteredFromLanding && !useAuthStore.getState().session
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
    if (progress.interview !== 'done') {
      feedback.message('正在生成中，请稍后')
      return
    }

    const historyId = await saveCurrentResult(false)

    if (!historyId) {
      return
    }

    continuationRef.current += 1
    void route.navigate(appendRouteParams(routePaths.complete, {historyId}))
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
    await route.navigate(routePaths.create, {
      step: 'jobDescription',
      mode: 'editHistory',
      historyId: savedHistoryId,
    })
  }

  const handlePendingStage = () => {
    feedback.message(generationError || '正在生成中，请稍后')
  }

  const handleOptimizedResumeChange = async (markdown: string) => {
    if (!result) return

    const nextResult: ProcessResult = {
      ...result,
      optimized: {
        ...result.optimized,
        optimized_resume: markdown,
      },
    }

    setResult(nextResult)
    syncWorkspaceResult(nextResult, resultContext)
    setSaved(false)

    if (!resultContext) return

    await saveLatestResultSession({
      context: resultContext,
      result: nextResult,
      progress,
    })
  }

  return {
    result,
    resumeContent: resultContext?.resumeContent || '',
    jdContent: resultContext?.jdContent || '',
    loading,
    saved,
    progress,
    progressPercent: getProgressPercent(progress),
    generationError,
    enteredFromCard,
    enteredFromLanding,
    returnCard,
    canEditHistory: Boolean(savedHistoryId),
    handleSave,
    handleComplete,
    handleShare,
    handleBackHome,
    handleEditHistory,
    handlePendingStage,
    handleOptimizedResumeChange,
  }
}
