import {useEffect, useRef, useState} from 'react'
import Taro, {useRouter} from '@tarojs/taro'
import {resumeApi} from '@/services/resume'
import {useHistoryStore} from '@/store/historyStore'
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
import {navigation} from '@/utils/navigation'
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

export interface ResultPageViewModel {
  result: ProcessResult | null
  loading: boolean
  saved: boolean
  progress: LatestResultSessionProgress
  progressPercent: number
  generationError: string | null
  enteredFromCard: boolean
  returnCard: HomeCardItem | null
  handleSave: () => Promise<string | null>
  handleComplete: () => Promise<void>
  handleShare: () => Promise<void>
  handleBackHome: () => Promise<void>
  handlePendingStage: () => void
  handleOptimizedResumeChange: (markdown: string) => Promise<void>
}

export function usePageModel(): ResultPageViewModel {
  const router = useRouter()
  const {addHistory} = useHistoryStore()
  const enteredFromCard = router.params.fromCard === '1'
  const [result, setResult] = useState<ProcessResult | null>(null)
  const [resultContext, setResultContext] =
    useState<LatestResultSessionContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [savedHistoryId, setSavedHistoryId] = useState<string | null>(
    typeof router.params.id === 'string' ? router.params.id : null,
  )
  const [progress, setProgress] = useState<LatestResultSessionProgress>(
    getDefaultProgress(null),
  )
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [returnCard, setReturnCard] = useState<HomeCardItem | null>(null)
  const continuationRef = useRef(0)
  const isContinuingRef = useRef(false)

  useEffect(() => {
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

        setResult(processResult)
        setResultContext(buildContextFromHistory(history))
        setProgress(historyProgress)
        setSaved(true)
        setSavedHistoryId(id)
      } else {
        feedback.message('未找到结果')
        void navigation.returnHome()
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
        setReturnCard(null)
        setProgress(sessionProgress)
        void continueLatestSession({
          ...session,
          result: sessionResult,
          progress: sessionProgress,
        })
      } else {
        feedback.message('未找到结果')
        void navigation.returnHome()
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
          currentSession.context.jdContent,
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

      const historyId = await addHistory({
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
        },
        progress,
      })

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
    void navigation.navigateTo(`/pages/complete/index?historyId=${encodeURIComponent(historyId)}`)
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
      return navigation.returnHome()
    }

    return navigation.reLaunch('/pages/index/index')
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
    loading,
    saved,
    progress,
    progressPercent: getProgressPercent(progress),
    generationError,
    enteredFromCard,
    returnCard,
    handleSave,
    handleComplete,
    handleShare,
    handleBackHome,
    handlePendingStage,
    handleOptimizedResumeChange,
  }
}
