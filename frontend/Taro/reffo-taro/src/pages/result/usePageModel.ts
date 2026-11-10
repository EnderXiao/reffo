import {strategyResultExcerpts} from '@/shared/resume-strategy'
import {normalizeCompletionDocument, serializeDraft, validateCompletionDocument, type ResumeCompletionDocument} from '@/shared/resume-completion'
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
  getResultSessionStorageKey,
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
import {generationTasksApi} from '@/services/backgroundGeneration'
import {useBackgroundGenerationStore} from '@/store/backgroundGenerationStore'
import {historyCompletionBaseline, resolveHistorySession, resultSnapshotKey, sameCompletionState} from './model/completionSession'

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
  handleCompletionDocumentChange?: (document: ResumeCompletionDocument, baseRevision: number, baseMarkdown: string) => Promise<void>
  completionSaveStatus?: 'idle' | 'saving' | 'failed'
  recoveryConflict?: boolean
  handleResolveRecovery?: (choice: 'history' | 'session') => Promise<void>
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
  const sessionSequenceRef = useRef(initialSessionRef.current?.sessionSequence ?? 0)
  const pageEpochRef = useRef(0)
  const ownerId = useAuthStore(state => state.session?.user.id)
  const ownerRef = useRef(ownerId)
  ownerRef.current = ownerId
  const savedSnapshotRef = useRef<string | null>(null)
  const historySaveRef = useRef<Promise<string | null> | null>(null)
  const completionWriteSequenceRef = useRef(0)
  const acknowledgedCompletionRef = useRef<{documentId: string; revision: number} | null>(null)
  const appliedCompletionRef = useRef(new Map<string, string>())
  const recoveryRef = useRef<{history: LatestResultSession; session: LatestResultSession} | null>(null)
  const [recoveryConflict, setRecoveryConflict] = useState(false)
  const [completionSaveStatus, setCompletionSaveStatus] = useState<'idle' | 'saving' | 'failed'>('idle')
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

  useEffect(() => () => {
    pageEpochRef.current += 1
    continuationRef.current += 1
    if (workspaceGenerationRunRef.current != null) {
      resumeWorkspaceActions.cancelGeneration(workspaceGenerationRunRef.current)
      workspaceGenerationRunRef.current = null
    }
  }, [])

  useEffect(() => {
    continuationRef.current += 1
    isContinuingRef.current = false
    recoveryRef.current = null
    setRecoveryConflict(false)
    setCompletionSaveStatus('idle')
    acknowledgedCompletionRef.current = null
    appliedCompletionRef.current.clear()
    savedSnapshotRef.current = null
    const initialSession = initialSessionRef.current

    if (initialSession) {
      initialSessionRef.current = null
      void continueLatestSession(initialSession)
      return
    }

    pageEpochRef.current += 1
    if (resultId) {
      void loadFromHistory(resultId)
      return
    }

    void loadFromLatestSession()
  }, [resultId, ownerId])

  const loadFromHistory = async (id: string) => {
    const epoch = pageEpochRef.current
    try {
      const [history, localSession] = await Promise.all([
        useHistoryStore.getState().loadHistory(id),
        getLatestResultSession().catch(() => null),
      ])
      if (epoch !== pageEpochRef.current) return

      if (history) {
        setReturnCard(toHistoryCardItem(history))
        const processResult: ProcessResult = history.processResult
          ? {
            ...history.processResult,
            optimized: {
              ...history.processResult.optimized,
              optimized_resume: history.optimizedContent,
              changes_summary: strategyResultExcerpts(history.processResult.optimized.strategy_review, history.optimizedContent),
            },
            interview: normalizeInterviewResult(history.processResult),
          }
          : buildFallbackResultFromHistory(history)
        const historyProgress = {
          ...DONE_PROGRESS,
          ...history.progress,
        }

        const context = buildContextFromHistory(history)
        const historySession: LatestResultSession = {
          result: processResult,
          context,
          progress: historyProgress,
          originHistoryId: id,
          baseHistorySnapshot: historyCompletionBaseline(history),
        }
        const resolution = resolveHistorySession(history, processResult, localSession)
        const resolvedSession = resolution === 'session' && localSession ? localSession : historySession
        recoveryRef.current = resolution === 'conflict' && localSession
          ? {history: historySession, session: localSession} : null
        setRecoveryConflict(resolution === 'conflict')
        latestSessionRef.current = resolvedSession
        sessionSequenceRef.current = resolvedSession.sessionSequence ?? 0
        setResult(resolvedSession.result)
        setResultContext(resolvedSession.context)
        syncWorkspaceResult(resolvedSession.result, resolvedSession.context)
        resumeWorkspaceActions.markGenerationCompleted()
        setProgress(resolvedSession.progress ?? historyProgress)
        savedSnapshotRef.current = resultSnapshotKey(processResult)
        setSaved(resolution === 'history')
        setSavedHistoryId(id)
        if (generationJobId) {
          try {
            const task = await generationTasksApi.get(generationJobId)
            if (task.history_id === id && task.status === 'completed') {
              setNeedsCompletion(!task.confirmed_at)
              if (!task.read_at) {
                const updated = await generationTasksApi.action(generationJobId, 'read')
                useBackgroundGenerationStore.getState().upsert(updated)
              }
            } else {
              setNeedsCompletion(false)
            }
          } catch {
            feedback.message('已读状态暂未同步，稍后可重试')
          }
        }
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
    const epoch = pageEpochRef.current
    try {
      const session = await getLatestResultSession()
      if (epoch !== pageEpochRef.current) return

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
        sessionSequenceRef.current = session.sessionSequence ?? 0
        setSavedHistoryId(session.originHistoryId ?? null)
        const baseline = session.baseHistorySnapshot
        const matchesHistory = Boolean(session.originHistoryId && baseline && sameCompletionState(session.result.optimized, {
          optimized_resume: baseline.optimizedContent,
          completion_document: baseline.completionDocument,
        }))
        savedSnapshotRef.current = matchesHistory ? resultSnapshotKey(sessionResult) : null
        setSaved(matchesHistory)
        setResult(sessionResult)
        setResultContext(session.context)
        syncWorkspaceResult(sessionResult, session.context)
        setReturnCard(null)
        setProgress(sessionProgress)
        void continueLatestSession(nextSession)
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

  const queueSessionSave = (nextSession: LatestResultSession) => {
    const storageKey = getResultSessionStorageKey()
    const owner = ownerRef.current
    const epoch = pageEpochRef.current
    const write = sessionWriteQueueRef.current
      .catch(() => undefined)
      .then(() => {
        if (ownerRef.current !== owner || useAuthStore.getState().session?.user.id !== owner || pageEpochRef.current !== epoch) {
          throw new Error('当前简历已切换，请重新打开后保存')
        }
        return saveLatestResultSession(nextSession, storageKey).then(() => {
          if (pageEpochRef.current !== epoch || ownerRef.current !== owner) return
          const document = nextSession.result.optimized.completion_document
          const previous = acknowledgedCompletionRef.current
          if (document && (!previous || previous.documentId !== document.documentId || previous.revision < document.revision)) {
            acknowledgedCompletionRef.current = {documentId: document.documentId, revision: document.revision}
          }
        })
      })
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
      sessionSequence: ++sessionSequenceRef.current,
    }

    latestSessionRef.current = nextSession
    setResult(nextResult)
    setProgress(nextProgress)
    syncWorkspaceResult(nextResult, nextSession.context)
    setSaved(savedSnapshotRef.current === resultSnapshotKey(nextResult))
    await queueSessionSave(nextSession)

    return nextSession
  }

  const continueLatestSession = async (session: LatestResultSession) => {
    if (isContinuingRef.current) return

    const owner = ownerRef.current
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

        if (continuationRef.current !== runId || ownerRef.current !== owner || useAuthStore.getState().session?.user.id !== owner) return

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

        if (continuationRef.current !== runId || ownerRef.current !== owner || useAuthStore.getState().session?.user.id !== owner) return

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

        if (continuationRef.current !== runId || ownerRef.current !== owner || useAuthStore.getState().session?.user.id !== owner) return

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
      if (continuationRef.current !== runId || ownerRef.current !== owner || useAuthStore.getState().session?.user.id !== owner) return

      const message = error instanceof Error ? error.message : '生成失败，请重试'
      resumeWorkspaceActions.failGeneration(workspaceRunId, message)
      console.error('continue result generation failed', error)
      setGenerationError(message)
      const failedProgress: LatestResultSessionProgress = {
        ...(latestSessionRef.current?.progress ?? currentProgress),
        matching: currentProgress.matching === 'generating' ? 'failed' : currentProgress.matching,
        optimized: currentProgress.optimized === 'generating' ? 'failed' : currentProgress.optimized,
        interview: currentProgress.interview === 'generating' ? 'failed' : currentProgress.interview,
      }
      const failedSession: LatestResultSession = {
        ...(latestSessionRef.current ?? currentSession),
        result: resultRef.current ?? currentResult,
        progress: failedProgress,
        sessionSequence: ++sessionSequenceRef.current,
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

  const writeCurrentHistory = async (showFeedback = true) => {
    const currentResult = resultRef.current
    if (!currentResult) return savedHistoryId

    if (recoveryRef.current) {
      feedback.message('请先选择要恢复的简历版本')
      return null
    }
    if (completionSaveStatus !== 'idle') {
      feedback.message('请先完成当前填写的保存')
      return null
    }
    const snapshotKey = resultSnapshotKey(currentResult)
    if (savedSnapshotRef.current === snapshotKey) return savedHistoryId

    if (progress.interview !== 'done') {
      feedback.message('正在生成中，请稍后')
      return null
    }

    try {
      const epoch = pageEpochRef.current
      const currentSession = latestSessionRef.current
      const baseHistory = createHistoryFromResult(
        currentResult,
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
        processResult: currentResult,
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

      if (epoch !== pageEpochRef.current) return historyId
      savedSnapshotRef.current = snapshotKey
      setSaved(resultRef.current != null && resultSnapshotKey(resultRef.current) === snapshotKey)
      setSavedHistoryId(historyId)
      const latest = latestSessionRef.current ?? currentSession
      if (latest) {
        const nextSession: LatestResultSession = {
          ...latest,
          originHistoryId: historyId,
          baseHistorySnapshot: historyCompletionBaseline({...history, id: historyId}),
          sessionSequence: ++sessionSequenceRef.current,
        }
        latestSessionRef.current = nextSession
        // 历史已保存时不把随后发生的新编辑覆盖成请求发出时的正文。
        await queueSessionSave(nextSession).catch(() => {
          feedback.message('历史已保存，当前会话同步暂未完成')
        })
      }
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

  const saveCurrentResult = (showFeedback = true) => {
    if (historySaveRef.current) return historySaveRef.current
    const write = writeCurrentHistory(showFeedback).finally(() => {
      if (historySaveRef.current === write) historySaveRef.current = null
    })
    historySaveRef.current = write
    return write
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
      if (resultRef.current && savedSnapshotRef.current !== resultSnapshotKey(resultRef.current)) {
        feedback.message('简历有新的修改，请再次完成保存')
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

  const commitOptimizedResult = async (
    markdown: string,
    document?: ResumeCompletionDocument,
  ) => {
    const currentResult = resultRef.current ?? result
    if (!currentResult) return
    if (recoveryRef.current) throw new Error('请先选择要恢复的简历版本')
    const epoch = pageEpochRef.current
    const writeSequence = ++completionWriteSequenceRef.current

    const nextResult: ProcessResult = {
      ...currentResult,
      optimized: {
        ...currentResult.optimized,
        optimized_resume: markdown,
        completion_document: document,
        changes_summary: strategyResultExcerpts(currentResult.optimized.strategy_review, markdown),
      },
    }

    setResult(nextResult)
    syncWorkspaceResult(nextResult, resultContext)
    setSaved(false)
    setCompletionSaveStatus('saving')

    const context = latestSessionRef.current?.context ?? resultContext
    if (!context) {
      setCompletionSaveStatus('failed')
      throw new Error('缺少当前会话，填写内容尚未保存')
    }

    const nextSession: LatestResultSession = {
      ...(latestSessionRef.current ?? {context, result: nextResult}),
      context,
      result: nextResult,
      progress: latestSessionRef.current?.progress ?? progress,
      sessionSequence: ++sessionSequenceRef.current,
    }
    latestSessionRef.current = nextSession
    try {
      await queueSessionSave(nextSession)
      if (epoch === pageEpochRef.current && writeSequence === completionWriteSequenceRef.current) setCompletionSaveStatus('idle')
    } catch (error) {
      if (epoch === pageEpochRef.current && writeSequence === completionWriteSequenceRef.current) setCompletionSaveStatus('failed')
      throw error
    }
  }

  const handleOptimizedResumeChange = (markdown: string) => commitOptimizedResult(markdown)

  const handleCompletionDocumentChange = async (
    document: ResumeCompletionDocument,
    baseRevision: number,
    baseMarkdown: string,
  ) => {
    const current = resultRef.current?.optimized
    if (!current) throw new Error('未找到当前简历')
    const markdown = serializeDraft(document)
    const operationKey = `${document.documentId}:${document.revision}`
    const previousSubmission = appliedCompletionRef.current.get(operationKey)
    if (previousSubmission === JSON.stringify(document) && current.completion_document?.documentId === document.documentId
      && current.completion_document.revision > document.revision) {
      const acknowledged = acknowledgedCompletionRef.current
      if (acknowledged?.documentId === document.documentId && acknowledged.revision >= document.revision) return
      // 新稿已包含这个提交；只持久化当前稿，绝不把旧失败快照重新发布。
      await commitOptimizedResult(current.optimized_resume, current.completion_document)
      return
    }
    const retry = sameCompletionState(current, {optimized_resume: markdown, completion_document: document})
    const currentState = normalizeCompletionDocument(current.optimized_resume, current.completion_document)
    if (!retry && (current.optimized_resume !== baseMarkdown
      || (currentState.status === 'ready' && current.completion_document && (current.completion_document.documentId !== document.documentId
        || current.completion_document.revision !== baseRevision)))) {
      throw new Error('这份简历已更新，请取消后重新打开此处编辑')
    }
    const validation = validateCompletionDocument(document)
    if (!validation.ok) throw new Error(validation.issues[0]?.message || '简历结构需要修复')
    appliedCompletionRef.current.set(operationKey, JSON.stringify(document))
    // 重试仅重新保存当前完整会话，不重新应用命令或增加文档版本。
    await commitOptimizedResult(markdown, document)
  }

  const handleResolveRecovery = async (choice: 'history' | 'session') => {
    const conflict = recoveryRef.current
    if (!conflict) return
    const selected = choice === 'history' ? conflict.history : {
      ...conflict.session,
      baseHistorySnapshot: conflict.history.baseHistorySnapshot,
    }
    const nextSession = {...selected, sessionSequence: ++sessionSequenceRef.current}
    await queueSessionSave(nextSession)
    latestSessionRef.current = nextSession
    recoveryRef.current = null
    setRecoveryConflict(false)
    setResult(nextSession.result)
    setResultContext(nextSession.context)
    setProgress(nextSession.progress ?? DONE_PROGRESS)
    syncWorkspaceResult(nextSession.result, nextSession.context)
    setSaved(choice === 'history')
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
    handleCompletionDocumentChange,
    completionSaveStatus,
    recoveryConflict,
    handleResolveRecovery,
  }
}
