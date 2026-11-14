import {actionContentDigest, buildChangeManifest, changeManifestDescriptions, reconcileEditorialActions} from '@/shared/resume-actions'
import type {ResumeExportTarget} from '@/services/resumeExport'
import {resumeHistoryApi} from '@/services/resumeHistory'
import {getPublicRuntimeConfig} from '@/services/runtime-config'
import {strategyResultExcerpts} from '@/shared/resume-strategy'
import {hasLinkedCompletion, isCompletionV4, normalizeCompletionDocument, serializeDraft, validateCompletionDocument, type CompletionEditJournal, type CompletionOperation, type ResumeCompletionDocument} from '@/shared/resume-completion'
import {useCallback, useEffect, useRef, useState} from 'react'
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
import {RequestError} from '@/utils/httpTransport'
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
import {interviewNeedsRefresh, upgradeInterviewPresentation} from './model/interviewReferences'
import {mergeAuthoritativeReview} from './model/actionReviewState'
import {historyCompletionBaseline, resolveHistorySession, resultSnapshotKey, sameCompletionState} from './model/completionSession'
import {acknowledgeCompletionEdits, appendCompletionEdits, rebaseCompletionEdits} from './model/completionJournal'

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
    ...(interview.presentation?.version === 'interview-presentation-v1' ? {presentation: interview.presentation} : {}),
    ...(Array.isArray(interview.preparation_topics) ? {preparation_topics: interview.preparation_topics} : {}),
    ...(interview.based_on_document ? {based_on_document: interview.based_on_document} : {}),
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
    matching: (result.matching?.match_score != null || Boolean(result.matching?.action_plan)) ? 'done' : 'pending',
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
  handleCompletionEditingChange?: (active: boolean) => void
  handleCompletionDocumentChange?: (document: ResumeCompletionDocument, baseRevision: number, baseMarkdown: string, operation?: CompletionOperation | CompletionOperation[]) => Promise<void>
  prepareDownload?: () => Promise<ResumeExportTarget>
  retryCompletionSave?: () => Promise<void>
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
  const [localCompletionAccess, setLocalCompletionAccess] = useState(false)
  const hasCompletionRemoteAccess = Boolean(ownerId || localCompletionAccess)
  useEffect(() => {
    let current = true
    setLocalCompletionAccess(false)
    if (!ownerId) {
      void getPublicRuntimeConfig().then(config => {
        if (current) setLocalCompletionAccess(config.appEnv === 'local' && config.authRequired === false)
      }).catch(() => undefined)
    }
    return () => { current = false }
  }, [ownerId])
  const ownerRef = useRef(ownerId)
  ownerRef.current = ownerId
  const savedSnapshotRef = useRef<string | null>(null)
  const historySaveRef = useRef<Promise<string | null> | null>(null)
  const remoteWriteQueueRef = useRef<Promise<unknown>>(Promise.resolve())
  const requiresBaselineRefreshRef = useRef(false)
  const remoteHistoryIdRef = useRef<string | null>(resultId)
  const pendingHistoryCommitRef = useRef<{snapshotKey: string; history: ResumeHistory} | null>(null)
  const completionWriteSequenceRef = useRef(0)
  const acknowledgedCompletionRef = useRef<{documentId: string; revision: number} | null>(null)
  const appliedCompletionRef = useRef(new Map<string, string>())
  const upgradeAttemptsRef = useRef(new Set<string>())
  const upgradeRunningRef = useRef<number | null>(null)
  const upgradeSequenceRef = useRef(0)
  const editorActiveRef = useRef(false)
  const [editorActive, setEditorActive] = useState(false)
  const handleCompletionEditingChange = useCallback((active: boolean) => { editorActiveRef.current = active; setEditorActive(active) }, [])
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
  const generationJobUnsubscribeRef = useRef<(() => void) | null>(null)
  const generationJobReadRef = useRef(false)
  const generationTaskUpdatedAtRef = useRef('')
  const historyRefreshQueueRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => () => {
    pageEpochRef.current += 1
    continuationRef.current += 1
    generationJobUnsubscribeRef.current?.()
    generationJobUnsubscribeRef.current = null
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
    remoteHistoryIdRef.current = resultId
    pendingHistoryCommitRef.current = null
    requiresBaselineRefreshRef.current = false
    upgradeAttemptsRef.current.clear()
    upgradeRunningRef.current = null
    const initialSession = initialSessionRef.current

    if (initialSession) {
      initialSessionRef.current = null
      const completed = Object.values({...getDefaultProgress(initialSession.result), ...initialSession.progress}).every(status => status === 'done')
      if (initialSession.originHistoryId && completed) void loadFromLatestSession(initialSession)
      else void continueLatestSession(initialSession)
      return
    }

    pageEpochRef.current += 1
    if (resultId) {
      generationJobUnsubscribeRef.current?.()
      generationJobUnsubscribeRef.current = null
      void loadFromHistory(resultId)
      return
    }

    void loadFromLatestSession()
  }, [resultId, ownerId])

  const loadOwnedHistory = async (id: string) => {
    const epoch = pageEpochRef.current
    if (!useAuthStore.getState().session) {
      const config = await getPublicRuntimeConfig().catch(() => null)
      if (config?.appEnv === 'local' && config.authRequired === false) {
        // 强制打开结果时从同一开发用户的权威记录读取，避免匿名缓存带回升级前的旧稿。
        const history = await resumeHistoryApi.getHistory(id)
        if (epoch === pageEpochRef.current && !useAuthStore.getState().session) {
          useHistoryStore.getState().acceptHistory(history)
        }
        return history
      }
    }
    return useHistoryStore.getState().loadHistory(id, {force: true})
  }

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
    const epoch = pageEpochRef.current
    try {
      const [remote, local] = await Promise.allSettled([
        loadOwnedHistory(id),
        getLatestResultSession(),
      ])
      if (epoch !== pageEpochRef.current) return
      const localSession = local.status === 'fulfilled' ? local.value : null
      if (remote.status === 'rejected') {
        if (localSession?.originHistoryId !== id) throw remote.reason
        latestSessionRef.current = localSession
        pendingHistoryCommitRef.current = localSession.pendingHistoryCommit ?? null
        sessionSequenceRef.current = localSession.sessionSequence ?? 0
        setResult(localSession.result)
        setResultContext(localSession.context)
        setProgress(localSession.progress ?? DONE_PROGRESS)
        setSaved(false)
        setSavedHistoryId(id)
        remoteHistoryIdRef.current = id
        requiresBaselineRefreshRef.current = true
        setCompletionSaveStatus('failed')
        syncWorkspaceResult(localSession.result, localSession.context)
        feedback.message('暂时无法核对远端版本，已保留本地编辑稿，请稍后重试同步')
        return
      }
      const history = remote.value
      requiresBaselineRefreshRef.current = false
      setCompletionSaveStatus('idle')
      if (history) {
        setReturnCard(toHistoryCardItem(history))
        const processResult: ProcessResult = history.processResult
          ? {
            ...history.processResult,
            optimized: {
              ...(history.processResult.optimized ?? {}),
              optimized_resume: history.optimizedContent || history.processResult.optimized?.optimized_resume || '',
              changes_summary: history.processResult.optimized?.change_manifest ? changeManifestDescriptions(history.processResult.optimized.change_manifest)
                : strategyResultExcerpts(history.processResult.optimized?.strategy_review, history.optimizedContent),
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
        const upgradedLocal = localSession ? {...localSession, result: upgradeInterviewPresentation(localSession.result, processResult)} : null
        const resolvedSession = resolution === 'session' && upgradedLocal ? upgradedLocal : historySession
        recoveryRef.current = resolution === 'conflict' && localSession
          ? {history: historySession, session: upgradedLocal!} : null
        setRecoveryConflict(resolution === 'conflict')
        latestSessionRef.current = resolvedSession
        pendingHistoryCommitRef.current = resolvedSession.pendingHistoryCommit ?? null
        sessionSequenceRef.current = resolvedSession.sessionSequence ?? 0
        setResult(resolvedSession.result)
        setResultContext(resolvedSession.context)
        syncWorkspaceResult(resolvedSession.result, resolvedSession.context)
        setProgress(resolvedSession.progress ?? historyProgress)
        savedSnapshotRef.current = resultSnapshotKey(processResult)
        setSaved(resolution === 'history')
        remoteHistoryIdRef.current = id
        setSavedHistoryId(id)

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

  const loadFromLatestSession = async (providedSession?: LatestResultSession) => {
    const epoch = pageEpochRef.current
    try {
      let session = providedSession ?? await getLatestResultSession()
      if (epoch !== pageEpochRef.current) return
      if (session?.originHistoryId) {
        const sessionProgress = {...getDefaultProgress(session.result), ...session.progress}
        if (Object.values(sessionProgress).every(status => status === 'done')) {
          try {
            const history = await loadOwnedHistory(session.originHistoryId)
            if (epoch !== pageEpochRef.current) return
            if (history?.processResult) session = {...session, result: upgradeInterviewPresentation(session.result, history.processResult)}
          } catch {
            // 展示升级读取失败时继续恢复本地稿，不触发生成。
          }
        }
      }

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
        pendingHistoryCommitRef.current = session.pendingHistoryCommit ?? null
        sessionSequenceRef.current = session.sessionSequence ?? 0
        remoteHistoryIdRef.current = session.originHistoryId ?? null
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
          if (document && ((!useAuthStore.getState().session && !localCompletionAccess) || document.schemaVersion === 'resume-completion-v1') && (!previous || previous.documentId !== document.documentId || previous.revision < document.revision)) {
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
          {
            ...(enteredFromLanding ? {landing: true, presetJdId: currentSession.context.presetJdId} : {}),
            ...(currentSession.context.resumeParseId ? {resumeParseId: currentSession.context.resumeParseId} : {}),
            ...(currentSession.context.jdParseId ? {jdParseId: currentSession.context.jdParseId} : {}),
          },
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

        let interview: ProcessResult['interview'] | undefined
        for (let attempt = 0; attempt < 3; attempt += 1) {
          currentResult = resultRef.current ?? currentResult
          let requestDocument = currentResult.optimized.completion_document
          if (requestDocument && requestDocument.revision > 0 && useAuthStore.getState().session) {
            await enqueueHistorySave(false, true)
            currentResult = resultRef.current ?? currentResult
            requestDocument = currentResult.optimized.completion_document
          }
          const requestOptimized = currentResult.optimized
          const historyId = remoteHistoryIdRef.current
          const options = {
            ...(enteredFromLanding ? {landing: true, presetJdId: currentSession.context.presetJdId} : {}),
            ...(historyId && requestDocument ? {historyId, documentRef: {documentId: requestDocument.documentId,
              revision: requestDocument.revision, resolvedDigest: requestOptimized.resolved_action_plan?.resolvedDigest}} : {}),
          }
          const response = await resumeApi.generateInterviewSuggestions(currentResult.analysis, currentResult.matching,
            requestOptimized, ...(Object.keys(options).length ? [options] : []))
          if (continuationRef.current !== runId || ownerRef.current !== owner || useAuthStore.getState().session?.user.id !== owner) return
          const latest = resultRef.current?.optimized
          if (!requestDocument || (latest?.completion_document?.documentId === requestDocument.documentId
            && latest.completion_document.revision === requestDocument.revision)) {
            interview = {...response, ...(requestDocument ? {based_on_document: {documentId: requestDocument.documentId,
              revision: requestDocument.revision, resolvedDigest: requestOptimized.resolved_action_plan?.resolvedDigest}} : {})}
            break
          }
        }
        if (!interview) throw new Error('简历在面试建议生成期间持续更新，请保存后重试面试建议')

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

  const persistCompletionHistory = async (history: ResumeHistory, existingId: string | null): Promise<string> => {
    if (localCompletionAccess && !useAuthStore.getState().session) {
      const epoch = pageEpochRef.current
      // 本地免登录由服务器固定开发用户鉴权；不伪造登录态，也不改变本地存储命名空间。
      const stored = existingId ? await resumeHistoryApi.updateHistory(existingId, history) : await resumeHistoryApi.saveHistory(history)
      if (epoch === pageEpochRef.current && !useAuthStore.getState().session) {
        useHistoryStore.getState().acceptHistory(stored)
      }
      return stored.id
    }
    if (existingId) { await useHistoryStore.getState().updateHistory(existingId, history); return existingId }
    return addHistory(history)
  }

  const writeCurrentHistory = async (showFeedback = true, allowIncomplete = false) => {
    let currentResult = resultRef.current
    if (!currentResult) return remoteHistoryIdRef.current

    if (recoveryRef.current) {
      feedback.message('请先选择要恢复的简历版本')
      return null
    }
    if (!allowIncomplete && completionSaveStatus !== 'idle') {
      feedback.message('请先完成当前填写的保存')
      return null
    }
    const snapshotKey = resultSnapshotKey(currentResult)
    if (savedSnapshotRef.current === snapshotKey && !pendingHistoryCommitRef.current
      && !currentResult.optimized.completion_edit?.operations.length) return remoteHistoryIdRef.current

    if (!allowIncomplete && progress.interview !== 'done') {
      feedback.message('正在生成中，请稍后')
      return null
    }

    try {
      const epoch = pageEpochRef.current
      const previousCommit = pendingHistoryCommitRef.current
      if (previousCommit && previousCommit.snapshotKey !== snapshotKey && hasCompletionRemoteAccess) {
        // 先核对响应可能丢失的前次提交，再用服务器确认的版本提交新稿。
        const previousId = await persistCompletionHistory(previousCommit.history, remoteHistoryIdRef.current)
        if (epoch !== pageEpochRef.current) return previousId
        const stored = useHistoryStore.getState().histories.find(item => item.id === previousId)
        const submitted = previousCommit.history.processResult?.optimized
        if (!stored || !submitted || (hasLinkedCompletion(submitted.completion_document)
          && stored.commitAck?.commit_id !== previousCommit.history.completionCommit?.commitId)) {
          throw new Error('前次保存尚未获得确认，请重试后继续')
        }
        remoteHistoryIdRef.current = previousId
        setSavedHistoryId(previousId)
        pendingHistoryCommitRef.current = null
        currentResult = resultRef.current ?? currentResult
        currentResult = {...currentResult, optimized: acknowledgeCompletionEdits(currentResult.optimized, submitted)}
        setResult(currentResult)
        if (latestSessionRef.current) {
          const recovered = {...latestSessionRef.current, result: currentResult, originHistoryId: previousId,
            baseHistorySnapshot: historyCompletionBaseline(stored), pendingHistoryCommit: undefined,
            sessionSequence: ++sessionSequenceRef.current}
          latestSessionRef.current = recovered
          await queueSessionSave(recovered)
        }
      }
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

      let history: ResumeHistory = {
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
          ...(resultContext?.jdParseId ? {jdParseId: resultContext.jdParseId} : {}),
          ...(resultContext?.resumeParseId ? {resumeParseId: resultContext.resumeParseId} : {}),
        },
        progress,
      }
      const baseline = currentSession?.baseHistorySnapshot
      const expected = baseline?.completionDocument
      const existing = useHistoryStore.getState().histories.find(item => item.id === remoteHistoryIdRef.current)
      const pending = pendingHistoryCommitRef.current
      if (pending?.snapshotKey === snapshotKey) history = pending.history
      else {
        history = {...history, id: (remoteHistoryIdRef.current ?? history.id) || `JD${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
          createdAt: existing?.createdAt ?? history.createdAt,
          completionCommit: {commitId: `commit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            ...(expected ? {expectedDocument: {documentId: expected.documentId, revision: expected.revision,
              ...(baseline?.resolvedDigest ? {resolvedDigest: baseline.resolvedDigest} : {})}} : {})}}
        pendingHistoryCommitRef.current = {snapshotKey, history}
      }
      if (latestSessionRef.current) {
        const pendingSession = {...latestSessionRef.current, pendingHistoryCommit: pendingHistoryCommitRef.current ?? undefined,
          sessionSequence: ++sessionSequenceRef.current}
        latestSessionRef.current = pendingSession
        await queueSessionSave(pendingSession)
      }
      const localOnly = enteredFromLanding && !useAuthStore.getState().session && !localCompletionAccess
      const historyId = localOnly
        ? await savePendingLandingHistory({...history, id: remoteHistoryIdRef.current ?? history.id})
        : await persistCompletionHistory(history, remoteHistoryIdRef.current)

      if (epoch !== pageEpochRef.current) return historyId
      const persisted = !localOnly ? useHistoryStore.getState().histories.find(item => item.id === historyId) : undefined
      const submittedDocument = currentResult.optimized.completion_document
      if (!localOnly && submittedDocument && hasLinkedCompletion(submittedDocument)
        && (persisted?.commitAck?.commit_id !== history.completionCommit?.commitId
          || persisted?.commitAck?.document_id !== submittedDocument.documentId || persisted?.commitAck?.revision !== submittedDocument.revision)) {
        throw new Error('服务端尚未确认当前简历版本，请重试保存')
      }
      pendingHistoryCommitRef.current = null
      if (!localOnly && submittedDocument) acknowledgedCompletionRef.current = {documentId: submittedDocument.documentId, revision: submittedDocument.revision}
      remoteHistoryIdRef.current = historyId
      if (resultRef.current && !localOnly) {
        let acknowledged = {...resultRef.current, optimized: acknowledgeCompletionEdits(resultRef.current.optimized, currentResult.optimized)}
        if (persisted?.processResult && sameCompletionState(resultRef.current.optimized, currentResult.optimized)) {
          acknowledged = {...acknowledged, optimized: mergeAuthoritativeReview(acknowledged.optimized, persisted.processResult.optimized)}
        }
        setResult(acknowledged)
        syncWorkspaceResult(acknowledged, resultContext)
      }
      const savedKey = resultRef.current && sameCompletionState(resultRef.current.optimized, currentResult.optimized)
        ? resultSnapshotKey(resultRef.current) : snapshotKey
      savedSnapshotRef.current = savedKey
      setSaved(resultRef.current != null && resultSnapshotKey(resultRef.current) === savedKey)
      setSavedHistoryId(historyId)
      const latest = latestSessionRef.current ?? currentSession
      if (latest) {
        const nextSession: LatestResultSession = {
          ...latest,
          result: resultRef.current ?? latest.result,
          originHistoryId: historyId,
          pendingHistoryCommit: undefined,
          baseHistorySnapshot: historyCompletionBaseline(persisted ?? {...history, id: historyId}),
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
      if (allowIncomplete) throw error
      feedback.error('保存失败')
      return null
    }
  }

  const enqueueHistorySave = (showFeedback = true, allowIncomplete = false) => {
    const owner = ownerRef.current
    const epoch = pageEpochRef.current
    const write = remoteWriteQueueRef.current.catch(() => undefined).then(() => {
      if (epoch !== pageEpochRef.current || owner !== ownerRef.current || useAuthStore.getState().session?.user.id !== owner) {
        throw new Error('当前账号或简历已切换，请重新打开后保存')
      }
      return writeCurrentHistory(showFeedback, allowIncomplete)
    })
    remoteWriteQueueRef.current = write
    return write
  }

  const saveCurrentResult = (showFeedback = true) => {
    if (historySaveRef.current) return historySaveRef.current
    const write = enqueueHistorySave(showFeedback).finally(() => {
      if (historySaveRef.current === write) historySaveRef.current = null
    })
    historySaveRef.current = write
    return write
  }

  useEffect(() => {
    const optimized = result?.optimized
    const document = optimized?.completion_document
    const pending = optimized?.action_review?.outcomes.some(item => item.state === 'pending_review')
    if (!savedHistoryId || !document || !pending || !hasCompletionRemoteAccess) return
    const epoch = pageEpochRef.current
    const owner = ownerRef.current
    let active = true
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      if (!active || ++attempts > 30) return
      try {
        const history = await resumeHistoryApi.getHistory(savedHistoryId)
        if (!active || epoch !== pageEpochRef.current || owner !== ownerRef.current) return
        const current = resultRef.current
        if (!current || !history.processResult) return
        const merged = mergeAuthoritativeReview(current.optimized, history.processResult.optimized)
        if (merged !== current.optimized && JSON.stringify(merged) !== JSON.stringify(current.optimized)) {
          const next = {...current, optimized: merged}
          setResult(next)
          syncWorkspaceResult(next, latestSessionRef.current?.context)
          if (latestSessionRef.current) {
            const session = {...latestSessionRef.current, result: next, sessionSequence: ++sessionSequenceRef.current}
            latestSessionRef.current = session
            await queueSessionSave(session)
          }
        }
        if (!merged.action_review?.outcomes.some(item => item.state === 'pending_review')) return
      } catch { /* 读取失败保留当前状态，不能触发重新生成或覆盖编辑稿。 */ }
      if (active) timer = setTimeout(() => void poll(), 2000)
    }
    timer = setTimeout(() => void poll(), 1000)
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [savedHistoryId, result?.optimized.completion_document?.documentId, result?.optimized.completion_document?.revision,
    result?.optimized.action_review?.reviewRevision, ownerId, hasCompletionRemoteAccess])

  useEffect(() => {
    const document = result?.optimized.completion_document
    const checked = document && validateCompletionDocument(document)
    if (loading || !hasCompletionRemoteAccess || !document || !checked?.ok || isCompletionV4(document) || editorActive
      || recoveryConflict || completionSaveStatus !== 'idle' || requiresBaselineRefreshRef.current
      || upgradeRunningRef.current != null || isContinuingRef.current || progress.optimized !== 'done'
      || progress.interview === 'generating') return
    const attemptKey = `${remoteHistoryIdRef.current ?? 'local'}:${actionContentDigest(document)}`
    if (upgradeAttemptsRef.current.has(attemptKey)) return
    upgradeAttemptsRef.current.add(attemptKey)
    const upgradeId = ++upgradeSequenceRef.current
    upgradeRunningRef.current = upgradeId
    const epoch = pageEpochRef.current
    const owner = ownerRef.current
    const stillCurrent = () => epoch === pageEpochRef.current && owner === ownerRef.current
      && owner === useAuthStore.getState().session?.user.id
    setCompletionSaveStatus('saving')
    const upgrade = remoteWriteQueueRef.current.catch(() => undefined).then(async () => {
      if (!stillCurrent()) return
      if (editorActiveRef.current || recoveryRef.current) { upgradeAttemptsRef.current.delete(attemptKey); return }
      // 旧基准及其编辑日志先得到服务端确认，随后才改变文档语义版本。
      await sessionWriteQueueRef.current
      const historyId = await writeCurrentHistory(false, true)
      if (!stillCurrent() || !historyId || editorActiveRef.current || recoveryRef.current) return
      const current = resultRef.current
      const snapshot = current?.optimized.completion_document
      if (!current || !snapshot || isCompletionV4(snapshot)) return
      if (pendingHistoryCommitRef.current || current.optimized.completion_edit?.operations.length) {
        throw new Error('本地填写尚未完成同步，请重试')
      }
      const history = await resumeHistoryApi.upgradeCompletion(historyId, snapshot)
      if (!stillCurrent()) return
      const latest = resultRef.current
      if (!latest || !sameCompletionState(latest.optimized, current.optimized) || editorActiveRef.current) {
        requiresBaselineRefreshRef.current = true
        throw new Error('升级期间简历已更新，本地编辑稿已保留，请重试同步')
      }
      if (!history.processResult || !isCompletionV4(history.processResult.optimized.completion_document)) {
        throw new Error('新版填写结构暂未就绪，当前编辑稿已保留')
      }
      const next: ProcessResult = {...history.processResult,
        optimized: {...history.processResult.optimized, optimized_resume: history.optimizedContent},
        interview: normalizeInterviewResult(history.processResult)}
      const session: LatestResultSession = {...(latestSessionRef.current ?? {context: buildContextFromHistory(history)}),
        result: next, originHistoryId: historyId, progress: history.progress ?? progress,
        pendingHistoryCommit: undefined, baseHistorySnapshot: historyCompletionBaseline(history),
        sessionSequence: ++sessionSequenceRef.current}
      // 先写入完整会话，下一次打开不能把旧稿重新带回升级后的记录。
      await queueSessionSave(session)
      if (!stillCurrent()) return
      latestSessionRef.current = session
      setResult(next)
      syncWorkspaceResult(next, session.context)
      useHistoryStore.getState().acceptHistory(history)
      remoteHistoryIdRef.current = historyId
      acknowledgedCompletionRef.current = {documentId: snapshot.documentId, revision: next.optimized.completion_document!.revision}
      savedSnapshotRef.current = resultSnapshotKey(next)
      setSavedHistoryId(historyId)
      setSaved(true)
    })
    remoteWriteQueueRef.current = upgrade
    void upgrade.catch(async error => {
      if (!stillCurrent()) return
      if (error instanceof RequestError && error.statusCode === 409 && remoteHistoryIdRef.current) {
        await loadFromHistory(remoteHistoryIdRef.current)
      } else {
        setCompletionSaveStatus('failed')
        feedback.message(error instanceof Error ? error.message : '填写结构升级暂未完成，当前编辑稿已保留')
      }
    }).finally(() => {
      if (upgradeRunningRef.current === upgradeId) upgradeRunningRef.current = null
      if (stillCurrent()) setCompletionSaveStatus(status => status === 'saving' ? 'idle' : status)
    })
  }, [loading, ownerId, hasCompletionRemoteAccess, result?.optimized.completion_document, savedHistoryId, completionSaveStatus,
    recoveryConflict, editorActive, progress.optimized, progress.interview])

  const handleSave = async () => saveCurrentResult(true)

  const retryCompletionSave = async () => {
    upgradeAttemptsRef.current.clear()
    if (recoveryRef.current) throw new Error('请先选择要恢复的简历版本')
    const epoch = pageEpochRef.current
    setCompletionSaveStatus('saving')
    try {
      if (requiresBaselineRefreshRef.current && remoteHistoryIdRef.current) {
        await loadFromHistory(remoteHistoryIdRef.current)
        if (requiresBaselineRefreshRef.current) throw new Error('暂时无法核对远端版本，请稍后重试同步')
        if (recoveryRef.current) throw new Error('远端简历也有更新，请先选择要保留的版本')
      }
      if (latestSessionRef.current) await queueSessionSave(latestSessionRef.current)
      const id = await enqueueHistorySave(false, true)
      if (!id) throw new Error('当前填写尚未同步，请稍后重试')
      if (epoch === pageEpochRef.current) setCompletionSaveStatus('idle')
    } catch (error) {
      if (epoch === pageEpochRef.current) setCompletionSaveStatus(recoveryRef.current ? 'idle' : 'failed')
      throw error
    }
  }

  const prepareDownload = async (): Promise<ResumeExportTarget> => {
    if (!useAuthStore.getState().session) throw new Error('请登录后下载正式 PDF，当前编辑稿已保留')
    const current = resultRef.current?.optimized
    const loaded = current && normalizeCompletionDocument(current.optimized_resume, current.completion_document)
    if (!loaded || loaded.blocked || loaded.status === 'repair_required') throw new Error('简历填写结构需要修复，请先检查对应内容')
    const document = loaded.document
    const historyId = await saveCurrentResult(false)
    if (!historyId) throw new Error('当前简历尚未保存成功，请重试')
    const latest = resultRef.current?.optimized
    if (!latest || latest.optimized_resume !== current!.optimized_resume || latest.completion_document?.documentId !== current!.completion_document?.documentId
      || latest.completion_document?.revision !== current!.completion_document?.revision) throw new Error('简历已更新，请重新下载当前版本')
    if (savedSnapshotRef.current !== resultSnapshotKey(resultRef.current!)) throw new Error('当前版本尚未获得保存确认，请稍后重试')
    return {historyId, documentId: document.documentId, revision: document.revision}
  }

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
        : progress.interview === 'failed' || (progress.interview === 'done' && interviewNeedsRefresh(result))

    if (completionSaveStatus !== 'idle') { feedback.message('请先完成当前填写的保存'); return }
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
    journal?: CompletionEditJournal,
  ) => {
    const currentResult = resultRef.current ?? result
    if (!currentResult) return
    if (recoveryRef.current) throw new Error('请先选择要恢复的简历版本')
    const epoch = pageEpochRef.current
    const writeSequence = ++completionWriteSequenceRef.current

    const actionReview = document && currentResult.optimized.resolved_action_plan ? reconcileEditorialActions({
      document, resolvedPlan: currentResult.optimized.resolved_action_plan, previousReview: currentResult.optimized.action_review,
    }) : undefined
    const manifest = actionReview && currentResult.optimized.resolved_action_plan
      ? buildChangeManifest(actionReview, currentResult.optimized.resolved_action_plan, {previous: currentResult.optimized.change_manifest, document}) : undefined
    const nextResult: ProcessResult = {
      ...currentResult,
      optimized: {
        ...currentResult.optimized,
        optimized_resume: markdown,
        completion_document: document,
        completion_edit: journal ?? currentResult.optimized.completion_edit,
        ...(actionReview ? {action_review: actionReview, change_manifest: manifest} : {}),
        changes_summary: manifest ? changeManifestDescriptions(manifest) : strategyResultExcerpts(currentResult.optimized.strategy_review, markdown),
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
      if (hasCompletionRemoteAccess && document && document.schemaVersion !== 'resume-completion-v1') {
        const id = await enqueueHistorySave(false, true)
        if (!id) throw new Error('填写内容已保存在本地，远端保存尚未确认，请重试')
      }
      if (epoch === pageEpochRef.current && writeSequence === completionWriteSequenceRef.current) setCompletionSaveStatus('idle')
    } catch (error) {
      if (epoch === pageEpochRef.current && writeSequence === completionWriteSequenceRef.current) setCompletionSaveStatus('failed')
      throw error
    }
  }

  const handleOptimizedResumeChange = (markdown: string) => {
    const currentDocument = resultRef.current?.optimized.completion_document
    if (currentDocument && currentDocument.schemaVersion !== 'resume-completion-v1') {
      return Promise.reject(new Error('请使用原位填写或整行修改，以保留关联结果的填写状态'))
    }
    return commitOptimizedResult(markdown)
  }

  const handleCompletionDocumentChange = async (
    document: ResumeCompletionDocument,
    baseRevision: number,
    baseMarkdown: string,
    operation?: CompletionOperation | CompletionOperation[],
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
    if (currentState.blocked) throw new Error('填写结构需要恢复，请重新打开有效版本')
    if (!retry && (current.optimized_resume !== baseMarkdown
      || (currentState.status === 'ready' && current.completion_document && (current.completion_document.documentId !== document.documentId
        || current.completion_document.revision !== baseRevision)))) {
      throw new Error('这份简历已更新，请取消后重新打开此处编辑')
    }
    const validation = validateCompletionDocument(document)
    if (!validation.ok) throw new Error(validation.issues[0]?.message || '简历结构需要修复')
    appliedCompletionRef.current.set(operationKey, JSON.stringify(document))
    // 重试仅重新保存当前完整会话，不重新应用命令或增加文档版本。
    await commitOptimizedResult(markdown, document, retry ? current.completion_edit : appendCompletionEdits(current, document, operation))
  }

  const handleResolveRecovery = async (choice: 'history' | 'session') => {
    const conflict = recoveryRef.current
    if (!conflict) return
    const hasStructured = (optimized: ProcessResult['optimized']) => Boolean(optimized.completion_document
      && optimized.completion_document.schemaVersion !== 'resume-completion-v1')
    const localOptimized = choice === 'session' && (hasStructured(conflict.session.result.optimized) || hasStructured(conflict.history.result.optimized))
      ? rebaseCompletionEdits(conflict.session.baseHistorySnapshot?.completionDocument, conflict.history.result.optimized, conflict.session.result.optimized)
      : conflict.session.result.optimized
    const selected = choice === 'history' ? conflict.history : {
      ...conflict.session,
      result: {...conflict.session.result, optimized: localOptimized},
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
    setSaved(resultSnapshotKey(nextSession.result) === resultSnapshotKey(conflict.history.result))
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
    prepareDownload,
    retryCompletionSave,
    handleComplete,
    handleShare,
    handleBackHome,
    handleEditHistory,
    handlePendingStage,
    handleRetryStage,
    handleOptimizedResumeChange,
    handleCompletionDocumentChange,
    handleCompletionEditingChange,
    completionSaveStatus,
    recoveryConflict,
    handleResolveRecovery,
  }
}
