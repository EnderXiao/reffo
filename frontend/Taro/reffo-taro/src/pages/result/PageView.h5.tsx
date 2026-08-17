import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import type {CSSProperties, TouchEvent} from 'react'
import {Image, ScrollView, Text, View} from '@tarojs/components'
import classNames from 'classnames'
import type {HardRequirement, ProcessResult} from '@/types'
import {FeedbackBubble} from '@/components/common/FeedbackBubble'
import {
  startResultCardReturnTransition,
  suppressNextNavigationTransition,
} from '@/utils/navigation-transition'
import {
  readSharedElementSnapshot,
  type SharedElementSnapshot,
} from '@/utils/shared-element-transition'
import type {LatestResultSessionProgress} from '@/utils/result-session'
import {resolveResumeGrade} from '@/utils/score-grade'
import type {ResultPageViewModel} from './usePageModel'
import {buildInterviewStoryViewItems} from './model/interviewReferences'
import LandingFlowHeader from '../create/components/LandingFlowHeader.h5'
import lightIcon from '@/assets/result/light.svg'
import textIcon from '@/assets/result/text.svg'
import suggestionIcon from '@/assets/result/suggestion.svg'
import downloadIcon from '@/assets/result/download.svg'
import editIcon from '@/assets/result/edit.svg'
import saveIcon from '@/assets/result/save.svg'
import cancelIcon from '@/assets/result/cancel.svg'
import alertIcon from '@/assets/result/alert-hex.svg'
import confirmIcon from '@/assets/result/confirm.svg'
import chatTagIcon from '@/assets/result/chat-tag.svg'
import exitIcon from '@/assets/result/exit.svg'
import '@/pages/index/index.h5.scss'
import './index.h5.scss'

type ResultStageKey = 'analysis' | 'resume' | 'interview'
type VisibleStageStatus = 'ready' | 'generating' | 'pending'
type StageMotionDirection = 'left' | 'right'

const CARD_OPEN_RECT_STORAGE_KEY = 'reffo.homeCardOpenRect'
const RESULT_RETURN_HOME_STORAGE_KEY = 'reffo.resultReturnHome'
const RESULT_RETURN_HOME_DOM_KEY = 'reffoReturnHomePending'
const RESULT_EDGE_ENTER_DELAY = 320
const RESULT_STAGE_BUBBLE_DURATION = 2200
const RESULT_BLOCKED_SHAKE_DURATION = 420
const RESULT_STAGE_SWIPE_THRESHOLD = 44
const RESULT_STAGE_SWITCH_DURATION = 520
const RESULT_BLOCKED_DRAG_LIMIT = 128
const RESULT_BLOCKED_DRAG_SETTLE_MS = 340
interface CardOpenRectSnapshot extends SharedElementSnapshot {
  cardId?: string
}

interface ResultStage {
  key: ResultStageKey
  title: string
  accent: string
  label: string
  subtitle: string
  icon: string
}

interface StageTransitionState {
  fromIndex: number
  toIndex: number
  direction: StageMotionDirection
  id: number
}

interface BlockedStagePreviewState {
  stageKey: ResultStageKey
  message: string
  direction: StageMotionDirection
  phase: 'dragging' | 'settling'
  offsetX: number
  progress: number
}

const RESULT_STAGES: ResultStage[] = [
  {
    key: 'analysis',
    title: '岗位分析',
    accent: '分析',
    label: '岗位分析',
    subtitle: '基于目标岗位描述与源简历进行岗位匹配分析，查看与目标岗位差距以及优化策略思路！',
    icon: lightIcon,
  },
  {
    key: 'resume',
    title: '相契简历',
    accent: '相契',
    label: '最佳简历',
    subtitle: '基于岗位分析生成人岗相契的简历，确保简历与目标岗位高度匹配！',
    icon: textIcon,
  },
  {
    key: 'interview',
    title: '面试建议',
    accent: '建议',
    label: '面试建议',
    subtitle: '查看Reffo为你生成的岗位分析，最佳简历以及针对性的面试建议！',
    icon: suggestionIcon,
  },
]

function normalizeItems(value: unknown, limit = 4): string[] {
  if (!Array.isArray(value)) return []

  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => item.trim())
    .slice(0, limit)
}

function readCardOpenRect(): CardOpenRectSnapshot | null {
  return readSharedElementSnapshot<CardOpenRectSnapshot>(CARD_OPEN_RECT_STORAGE_KEY, '卡片')
}

function getBlockedStageMessage(
  stageKey: ResultStageKey,
  progress: LatestResultSessionProgress,
  generationError?: string,
) {
  const stageStatus = getVisibleStageStatus(stageKey, progress)
  const message = generationError ||
    (stageStatus === 'generating' ? '步骤正在生成中' : '等待前置步骤完成')

  return {
    stageStatus,
    message,
  }
}

function markReturningHome(cardId?: string | null, transition?: 'view-transition') {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage?.setItem(RESULT_RETURN_HOME_STORAGE_KEY, JSON.stringify({
      cardId: cardId ?? null,
      transition,
    }))
    document.documentElement.dataset[RESULT_RETURN_HOME_DOM_KEY] = '1'
  } catch (error) {
    console.warn('保存首页返回过渡标记失败:', error)
  }
}

function getUnmatchedRequirements(items: HardRequirement[] | undefined) {
  if (!Array.isArray(items)) return []

  return items
    .filter(item => !item.matched)
    .map(item => item.suggestion || item.requirement)
    .filter(item => item.trim().length > 0)
    .slice(0, 3)
}

interface MarkdownLine {
  key: string
  raw: string
  prefix: string
  text: string
  kind:
    | 'heading1'
    | 'heading2'
    | 'heading3'
    | 'bullet'
    | 'numbered'
    | 'divider'
    | 'blank'
    | 'paragraph'
}

function parseMarkdownLine(raw: string, index: number): MarkdownLine {
  const heading = raw.match(/^(#{1,3})\s+(.*)$/)
  if (heading) {
    const level = heading[1].length
    return {
      key: `${index}-${raw}`,
      raw,
      prefix: `${heading[1]} `,
      text: heading[2],
      kind: level === 1 ? 'heading1' : level === 2 ? 'heading2' : 'heading3',
    }
  }

  const bullet = raw.match(/^(\s*[-*+]\s+)(.*)$/)
  if (bullet) {
    return {
      key: `${index}-${raw}`,
      raw,
      prefix: bullet[1],
      text: bullet[2],
      kind: 'bullet',
    }
  }

  const numbered = raw.match(/^(\s*\d+\.\s+)(.*)$/)
  if (numbered) {
    return {
      key: `${index}-${raw}`,
      raw,
      prefix: numbered[1],
      text: numbered[2],
      kind: 'numbered',
    }
  }

  if (/^\s*-{3,}\s*$/.test(raw)) {
    return {
      key: `${index}-divider`,
      raw,
      prefix: '',
      text: '',
      kind: 'divider',
    }
  }

  if (raw.trim().length === 0) {
    return {
      key: `${index}-blank`,
      raw,
      prefix: '',
      text: '',
      kind: 'blank',
    }
  }

  return {
    key: `${index}-${raw}`,
    raw,
    prefix: '',
    text: raw,
    kind: 'paragraph',
  }
}

function parseMarkdown(value: string): MarkdownLine[] {
  const lines = value.trim().length > 0 ? value.split('\n') : ['']

  return lines.map(parseMarkdownLine)
}

function canEditMarkdownLine(line: MarkdownLine) {
  return line.kind !== 'blank' && line.kind !== 'divider' && line.text.trim().length > 0
}

function getVisibleStageStatus(
  stage: ResultStageKey,
  progress: ResultPageViewModel['progress'],
): VisibleStageStatus {
  if (stage === 'analysis') {
    return progress.analysis === 'done' ? 'ready' : 'generating'
  }

  if (stage === 'resume') {
    if (progress.optimized === 'done') return 'ready'
    if (progress.matching === 'generating' || progress.optimized === 'generating') {
      return 'generating'
    }

    return 'pending'
  }

  if (progress.interview === 'done') return 'ready'
  if (progress.interview === 'generating') return 'generating'

  return 'pending'
}

function getDownloadName(result: ProcessResult) {
  const name = result.analysis.structured_resume.personal_info.name.trim()
  const safeName = name.replace(/[\\/:*?"<>|]/g, '').trim()

  return `${safeName || 'reffo'}-最佳简历.md`
}

function renderInlineMarkdown(value: string) {
  const segments = value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean)

  return segments.map((segment, index) => {
    if (segment.startsWith('**') && segment.endsWith('**')) {
      return (
        <Text key={`${segment}-${index}`} className='reffo-result__markdown-strong'>
          {segment.slice(2, -2)}
        </Text>
      )
    }

    if (segment.startsWith('`') && segment.endsWith('`')) {
      return (
        <Text key={`${segment}-${index}`} className='reffo-result__markdown-code'>
          {segment.slice(1, -1)}
        </Text>
      )
    }

    return segment
  })
}

function SectionTitle({children, icon}: {children: string; icon?: string}) {
  return (
    <View className='reffo-result__section-title'>
      {icon && (
        <Image className='reffo-result__section-icon' src={icon} mode='aspectFit' />
      )}
      <Text>{children}</Text>
    </View>
  )
}

function ResultStageTitle({stage}: {stage: ResultStage}) {
  const accentIndex = stage.title.indexOf(stage.accent)
  const titleBeforeAccent = accentIndex >= 0 ? stage.title.slice(0, accentIndex) : ''
  const titleAfterAccent = accentIndex >= 0
    ? stage.title.slice(accentIndex + stage.accent.length)
    : stage.title.replace(stage.accent, '')

  return (
    <>
      {titleBeforeAccent.length > 0 && (
        <Text className='reffo-result__title-prefix'>{titleBeforeAccent}</Text>
      )}
      <Text className='reffo-result__title-accent'>{stage.accent}</Text>
      {titleAfterAccent.length > 0 && (
        <Text className='reffo-result__title-prefix'>{titleAfterAccent}</Text>
      )}
      <View className='reffo-result__title-spark' aria-hidden='true'>
        <Text className='reffo-result__title-spark-main'>✦</Text>
        <Text className='reffo-result__title-spark-small'>✦</Text>
      </View>
    </>
  )
}

function InterviewQuoteList({
  items,
  className,
}: {
  items: string[]
  className: string
}) {
  return (
    <View className={className}>
      {items.map((item, index) => (
        <View key={`${item}-${index}`} className='reffo-result__interview-line-item'>
          <Text className='reffo-result__interview-quote'>“{item}”</Text>
        </View>
      ))}
    </View>
  )
}

function EmptyText() {
  return <Text className='reffo-result__empty'>暂无内容</Text>
}

function AnalysisPanel({result}: {result: ProcessResult}) {
  const grade = resolveResumeGrade(result.analysis.quality_score)
  const weaknesses = normalizeItems(result.analysis.weaknesses, 3)
  const strategies = normalizeItems(result.matching.optimization_suggestions, 5)

  return (
    <View className='reffo-result__panel'>
      <View className='reffo-result__score-row'>
        <Text className='reffo-result__grade'>{grade}</Text>
        <Text className='reffo-result__grade-label'>评级</Text>
      </View>

      <View className='reffo-result__alert reffo-result__alert--danger'>
        <View className='reffo-result__alert-heading'>
          <Image className='reffo-result__alert-icon' src={alertIcon} mode='aspectFit' />
          <Text>差距分析</Text>
        </View>
        {weaknesses.length > 0 ? (
          weaknesses.map((item, index) => (
            <Text key={`${item}-${index}`} className='reffo-result__paragraph'>
              {item}
            </Text>
          ))
        ) : (
          <EmptyText />
        )}
      </View>

      <View className='reffo-result__alert reffo-result__alert--success'>
        <View className='reffo-result__alert-heading'>
          <Image className='reffo-result__alert-icon' src={confirmIcon} mode='aspectFit' />
          <Text>优化策略</Text>
        </View>
        {strategies.length > 0 ? (
          strategies.map((item, index) => (
            <Text key={`${item}-${index}`} className='reffo-result__paragraph'>
              {item}
            </Text>
          ))
        ) : (
          <EmptyText />
        )}
      </View>
    </View>
  )
}

function ResumePanel({
  result,
  onOptimizedResumeChange,
}: {
  result: ProcessResult
  onOptimizedResumeChange: (markdown: string) => Promise<void>
}) {
  const [lines, setLines] = useState(() => parseMarkdown(result.optimized.optimized_resume))
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editingDraft, setEditingDraft] = useState('')
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const markdown = useMemo(() => lines.map(line => line.raw).join('\n'), [lines])
  const isEditing = editingIndex !== null

  const resizeEditor = (element: HTMLTextAreaElement | null) => {
    if (!element) return

    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }

  useEffect(() => {
    if (editingIndex !== null) return

    setLines(parseMarkdown(result.optimized.optimized_resume))
  }, [editingIndex, result.optimized.optimized_resume])

  const commitMarkdown = async (nextLines = lines) => {
    await onOptimizedResumeChange(nextLines.map(line => line.raw).join('\n'))
  }

  const handleEditLine = (lineIndex: number) => {
    setEditingIndex(lineIndex)
    setEditingDraft(lines[lineIndex]?.raw || '')
  }

  useEffect(() => {
    resizeEditor(editorRef.current)
  }, [editingDraft, editingIndex])

  const handleCancelEdit = () => {
    setEditingIndex(null)
    setEditingDraft('')
  }

  const handleSaveLine = async (lineIndex: number) => {
    const nextLines = lines.map((line, index) =>
      index === lineIndex ? parseMarkdownLine(editingDraft, index) : line,
    )

    setLines(nextLines)
    setEditingIndex(null)
    setEditingDraft('')
    await commitMarkdown(nextLines)
  }

  const handleDownload = () => {
    if (isEditing) return

    const blob = new Blob([markdown], {type: 'text/markdown;charset=utf-8'})
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = getDownloadName(result)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <View className='reffo-result__panel reffo-result__panel--resume'>
      <View className='reffo-result__resume-paper'>
        <View
          className={classNames('reffo-result__download', {
            'reffo-result__download--disabled': isEditing,
          })}
          onClick={handleDownload}
          aria-disabled={isEditing}
        >
          <Image className='reffo-result__download-icon' src={downloadIcon} mode='aspectFit' />
          <Text>下载</Text>
        </View>

        <View className='reffo-result__markdown'>
          {lines.map((line, index) => (
            <View
              key={`line-${index}`}
              className={classNames(
                'reffo-result__markdown-line',
                `reffo-result__markdown-line--${line.kind}`,
              )}
            >
              {editingIndex === index ? (
                <View className='reffo-result__markdown-editor'>
                  <textarea
                    ref={element => {
                      editorRef.current = element
                      resizeEditor(element)
                    }}
                    className='reffo-result__markdown-source'
                    value={editingDraft}
                    rows={1}
                    onInput={event => {
                      setEditingDraft(event.currentTarget.value)
                      resizeEditor(event.currentTarget)
                    }}
                  />
                  <View className='reffo-result__markdown-editor-actions'>
                    <View
                      className='reffo-result__markdown-save'
                      onClick={() => {
                        void handleSaveLine(index)
                      }}
                    >
                      <Image className='reffo-result__markdown-action-icon' src={saveIcon} mode='aspectFit' />
                    </View>
                    <View className='reffo-result__markdown-cancel' onClick={handleCancelEdit}>
                      <Image className='reffo-result__markdown-action-icon' src={cancelIcon} mode='aspectFit' />
                    </View>
                  </View>
                </View>
              ) : (
                <>
                  {line.kind === 'divider' ? (
                    <View className='reffo-result__markdown-divider' />
                  ) : (
                    <View className='reffo-result__markdown-rendered'>
                      {line.kind === 'bullet' && (
                        <Text className='reffo-result__markdown-marker'>•</Text>
                      )}
                      {line.kind === 'numbered' && (
                        <Text className='reffo-result__markdown-marker'>{line.prefix.trim()}</Text>
                      )}
                      <Text className='reffo-result__markdown-text'>
                        {renderInlineMarkdown(line.text)}
                        {canEditMarkdownLine(line) && (
                          <Image
                            className='reffo-result__markdown-edit-icon'
                            src={editIcon}
                            mode='aspectFit'
                            onClick={() => {
                              handleEditLine(index)
                            }}
                          />
                        )}
                      </Text>
                    </View>
                  )}
                </>
              )}
            </View>
          ))}
        </View>
      </View>
    </View>
  )
}

function InterviewPanel({
  result,
  resumeContent,
  jdContent,
}: {
  result: ProcessResult
  resumeContent: string
  jdContent: string
}) {
  const missingSkills = normalizeItems(result.matching.skill_match.missing_skills, 3)
  const unmatchedRequirements = getUnmatchedRequirements(result.matching.hard_requirements_match)
  const generatedQuestions = normalizeItems(result.interview?.questions, 4)
  const fallbackQuestions = [
    ...missingSkills.map(item => `你会如何补齐「${item}」相关经验？`),
    ...unmatchedRequirements.map(item => `针对「${item}」，你准备用什么项目证据回应？`),
  ].slice(0, 2)
  const questions = generatedQuestions.length > 0 ? generatedQuestions : fallbackQuestions
  const storyItems = buildInterviewStoryViewItems(result, resumeContent, jdContent)
  const generatedFollowUps = normalizeItems(result.interview?.follow_up_questions, 3)
  const followUps = generatedFollowUps.length > 0
    ? generatedFollowUps
    : [
        `这个岗位当前最希望新成员优先解决的业务问题是什么？`,
        `团队会如何衡量这个岗位在前三个月的成功表现？`,
      ]

  return (
    <View className='reffo-result__panel reffo-result__panel--interview'>
      <SectionTitle icon={chatTagIcon}>可能的问题</SectionTitle>
      <InterviewQuoteList
        className='reffo-result__question-list'
        items={questions.length > 0 ? questions : ['请介绍一段最能证明你适合这个岗位的经历。', '你如何理解这个岗位最核心的业务挑战？']}
      />

      <SectionTitle>明星故事推荐</SectionTitle>
      <View className='reffo-result__story-list'>
        {storyItems.map((item, index) => (
          <View key={`${item.title}-${index}`} className='reffo-result__story-block'>
            <Text className='reffo-result__story-title'>{item.title}</Text>
            <Text className='reffo-result__story-source'>
              来自源简历
              <Text className='reffo-result__story-reference'>{item.resumeQuote || '暂无可引用原文'}</Text>
              和岗位描述
              <Text className='reffo-result__story-reference'>{item.jdQuote || '暂无可引用原文'}</Text>
              。
            </Text>

            <Text className='reffo-result__story-label'>故事回顾：</Text>
            <View className='reffo-result__story-bullets'>
              <Text className='reffo-result__story-bullet'>• {item.background}</Text>
              <Text className='reffo-result__story-bullet'>• {item.result}</Text>
            </View>

            <Text className='reffo-result__story-label'>讲述思路：</Text>
            <View className='reffo-result__story-bullets'>
              <Text className='reffo-result__story-bullet'>
                • 从岗位描述中 <Text className='reffo-result__story-reference'>{item.jdQuote || '暂无可引用原文'}</Text> 对齐讲述重点，优先说明这段经历如何回应岗位要求。
              </Text>
              <Text className='reffo-result__story-bullet'>
                • 从源简历中 <Text className='reffo-result__story-reference'>{item.resumeQuote || '暂无可引用原文'}</Text> 回到可核验事实，避免把岗位要求包装成自己已经做过的经历。
              </Text>
            </View>
          </View>
        ))}
      </View>

      <SectionTitle>聪明的反问</SectionTitle>
      <InterviewQuoteList className='reffo-result__follow-list' items={followUps} />
    </View>
  )
}

function ResultContent({
  stage,
  result,
  resumeContent,
  jdContent,
  onOptimizedResumeChange,
}: {
  stage: ResultStageKey
  result: ProcessResult
  resumeContent: string
  jdContent: string
  onOptimizedResumeChange: (markdown: string) => Promise<void>
}) {
  if (stage === 'analysis') return <AnalysisPanel result={result} />
  if (stage === 'resume') {
    return (
      <ResumePanel
        result={result}
        onOptimizedResumeChange={onOptimizedResumeChange}
      />
    )
  }
  return <InterviewPanel result={result} resumeContent={resumeContent} jdContent={jdContent} />
}

type ResultPageViewProps = ResultPageViewModel & {
  hideLandingHeader?: boolean
}

export default function PageView({
  result,
  resumeContent,
  jdContent,
  loading,
  progress,
  progressPercent,
  generationError,
  enteredFromCard,
  enteredFromLanding,
  returnCard,
  canEditHistory,
  handleComplete,
  handleBackHome,
  handleEditHistory,
  handleOptimizedResumeChange,
  hideLandingHeader = false,
}: ResultPageViewProps) {
  const [stageIndex, setStageIndex] = useState(0)
  const [isFromCardReady, setIsFromCardReady] = useState(!enteredFromCard)
  const [isEdgeEnterReady, setIsEdgeEnterReady] = useState(!enteredFromCard)
  const [isReturningHome, setIsReturningHome] = useState(false)
  const [blockedBubble, setBlockedBubble] = useState<{
    stageKey: ResultStageKey
    message: string
  } | null>(null)
  const [isBlockedShaking, setIsBlockedShaking] = useState(false)
  const [stageTransition, setStageTransition] = useState<StageTransitionState | null>(null)
  const [blockedPreview, setBlockedPreview] = useState<BlockedStagePreviewState | null>(null)
  const rootRef = useRef<HTMLElement | null>(null)
  const returnTimerRef = useRef<number | null>(null)
  const edgeEnterTimerRef = useRef<number | null>(null)
  const bubbleTimerRef = useRef<number | null>(null)
  const shakeTimerRef = useRef<number | null>(null)
  const stageTransitionTimerRef = useRef<number | null>(null)
  const blockedPreviewTimerRef = useRef<number | null>(null)
  const stageTransitionIdRef = useRef(0)
  const touchStartRef = useRef<{x: number; y: number} | null>(null)
  const blockedPreviewRef = useRef<BlockedStagePreviewState | null>(null)
  const activeStage = RESULT_STAGES[stageIndex] ?? RESULT_STAGES[0]
  const blockedPreviewStage = blockedPreview
    ? RESULT_STAGES.find(stage => stage.key === blockedPreview.stageKey) ?? null
    : null
  const backgroundProgress = useMemo(
    () => enteredFromCard ? '100%' : `${progressPercent}%`,
    [enteredFromCard, progressPercent],
  )
  const stageAvailability: Record<ResultStageKey, boolean> = {
    analysis: progress.analysis === 'done',
    resume: progress.optimized === 'done',
    interview: progress.interview === 'done',
  }
  const readyStages = RESULT_STAGES.filter(stage => stageAvailability[stage.key])
  const blockedStages = RESULT_STAGES.filter(stage => !stageAvailability[stage.key])
  const activeReadyIndex = Math.max(0, readyStages.findIndex(stage => stage.key === activeStage.key))
  const isComplete = progress.interview === 'done'
  const hasRenderableResult = Boolean(result)
  const resultStyle = useMemo(() => ({
    '--reffo-result-progress': backgroundProgress,
    '--reffo-result-blocked-drag-x': `${blockedPreview?.offsetX ?? 0}px`,
    '--reffo-result-blocked-preview-progress': blockedPreview?.progress ?? 0,
    '--reffo-result-blocked-preview-scale': blockedPreview
      ? (0.92 + blockedPreview.progress * 0.08).toFixed(3)
      : 0.92,
  }) as CSSProperties, [backgroundProgress, blockedPreview])

  useEffect(() => {
    blockedPreviewRef.current = blockedPreview
  }, [blockedPreview])

  useEffect(() => {
    let firstFrame = 0
    let secondFrame = 0

    if (!enteredFromCard) {
      setIsFromCardReady(true)
      return undefined
    }

    if (loading || !hasRenderableResult) {
      setIsFromCardReady(false)
      return undefined
    }

    setIsFromCardReady(false)
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        setIsFromCardReady(true)
      })
    })

    return () => {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
    }
  }, [enteredFromCard, hasRenderableResult, loading])

  useEffect(() => {
    if (edgeEnterTimerRef.current != null) {
      window.clearTimeout(edgeEnterTimerRef.current)
      edgeEnterTimerRef.current = null
    }

    if (!enteredFromCard) {
      setIsEdgeEnterReady(true)
      return undefined
    }

    if (!isFromCardReady || loading || !hasRenderableResult) {
      setIsEdgeEnterReady(false)
      return undefined
    }

    setIsEdgeEnterReady(false)
    edgeEnterTimerRef.current = window.setTimeout(() => {
      edgeEnterTimerRef.current = null
      setIsEdgeEnterReady(true)
    }, RESULT_EDGE_ENTER_DELAY)

    return () => {
      if (edgeEnterTimerRef.current != null) {
        window.clearTimeout(edgeEnterTimerRef.current)
        edgeEnterTimerRef.current = null
      }
    }
  }, [enteredFromCard, hasRenderableResult, isFromCardReady, loading])

  useEffect(() => () => {
    if (edgeEnterTimerRef.current != null) {
      window.clearTimeout(edgeEnterTimerRef.current)
    }
    if (returnTimerRef.current != null) {
      window.clearTimeout(returnTimerRef.current)
    }
    if (bubbleTimerRef.current != null) {
      window.clearTimeout(bubbleTimerRef.current)
    }
    if (shakeTimerRef.current != null) {
      window.clearTimeout(shakeTimerRef.current)
    }
    if (stageTransitionTimerRef.current != null) {
      window.clearTimeout(stageTransitionTimerRef.current)
    }
    if (blockedPreviewTimerRef.current != null) {
      window.clearTimeout(blockedPreviewTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (stageAvailability[RESULT_STAGES[stageIndex].key]) {
      return
    }

    for (let index = RESULT_STAGES.length - 1; index >= 0; index -= 1) {
      if (stageAvailability[RESULT_STAGES[index].key]) {
        setStageIndex(index)
        return
      }
    }

    setStageIndex(0)
  }, [progress.analysis, progress.optimized, progress.interview, stageIndex])

  const showBlockedBubble = useCallback((
    stageKey: ResultStageKey,
    options: {shake?: boolean} = {},
  ) => {
    const {message} = getBlockedStageMessage(stageKey, progress, generationError)
    setBlockedBubble({stageKey, message})

    if (bubbleTimerRef.current != null) {
      window.clearTimeout(bubbleTimerRef.current)
    }

    bubbleTimerRef.current = window.setTimeout(() => {
      bubbleTimerRef.current = null
      setBlockedBubble(current => current?.stageKey === stageKey ? null : current)
    }, RESULT_STAGE_BUBBLE_DURATION)

    if (!options.shake) {
      return
    }

    setIsBlockedShaking(false)
    window.requestAnimationFrame(() => {
      setIsBlockedShaking(true)
    })

    if (shakeTimerRef.current != null) {
      window.clearTimeout(shakeTimerRef.current)
    }

    shakeTimerRef.current = window.setTimeout(() => {
      shakeTimerRef.current = null
      setIsBlockedShaking(false)
    }, RESULT_BLOCKED_SHAKE_DURATION)
  }, [generationError, progress])

  const settleBlockedPreview = useCallback((
    stageKey: ResultStageKey,
    direction: StageMotionDirection,
  ) => {
    const {message} = getBlockedStageMessage(stageKey, progress, generationError)

    if (blockedPreviewTimerRef.current != null) {
      window.clearTimeout(blockedPreviewTimerRef.current)
      blockedPreviewTimerRef.current = null
    }

    setBlockedPreview({
      stageKey,
      message,
      direction,
      phase: 'settling',
      offsetX: 0,
      progress: 0,
    })

    blockedPreviewTimerRef.current = window.setTimeout(() => {
      blockedPreviewTimerRef.current = null
      setBlockedPreview(current => (
        current?.stageKey === stageKey && current.phase === 'settling' ? null : current
      ))
    }, RESULT_BLOCKED_DRAG_SETTLE_MS)
  }, [generationError, progress])

  const requestStageSwitch = useCallback((
    nextIndex: number,
    options: {shake?: boolean; direction?: StageMotionDirection; showBubble?: boolean} = {},
  ) => {
    const nextStage = RESULT_STAGES[nextIndex]

    if (!nextStage || nextIndex === stageIndex) {
      return
    }

    if (!stageAvailability[nextStage.key]) {
      if (options.showBubble !== false) {
        showBlockedBubble(nextStage.key, options)
      }
      return
    }

    setBlockedBubble(null)
    stageTransitionIdRef.current += 1
    setStageTransition({
      fromIndex: stageIndex,
      toIndex: nextIndex,
      direction: options.direction ?? (nextIndex > stageIndex ? 'left' : 'right'),
      id: stageTransitionIdRef.current,
    })
    setStageIndex(nextIndex)

    if (stageTransitionTimerRef.current != null) {
      window.clearTimeout(stageTransitionTimerRef.current)
    }

    stageTransitionTimerRef.current = window.setTimeout(() => {
      stageTransitionTimerRef.current = null
      setStageTransition(current => current?.toIndex === nextIndex ? null : current)
    }, RESULT_STAGE_SWITCH_DURATION)
  }, [showBlockedBubble, stageAvailability, stageIndex])

  const handleStageTouchStart = useCallback((event: TouchEvent) => {
    const touch = event.touches[0] ?? event.changedTouches[0]

    if (!touch) {
      touchStartRef.current = null
      return
    }

    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    }
  }, [])

  const handleStageTouchMove = useCallback((event: TouchEvent) => {
    const start = touchStartRef.current
    const touch = event.touches[0] ?? event.changedTouches[0]

    if (!start || !touch) {
      return
    }

    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    const absX = Math.abs(deltaX)
    const absY = Math.abs(deltaY)

    if (absX < 8 || absX < absY * 1.15) {
      if (blockedPreviewRef.current?.phase === 'dragging') {
        setBlockedPreview(null)
      }
      return
    }

    const direction: StageMotionDirection = deltaX < 0 ? 'left' : 'right'
    const nextIndex = stageIndex + (direction === 'left' ? 1 : -1)
    const nextStage = RESULT_STAGES[nextIndex]

    if (!nextStage || stageAvailability[nextStage.key]) {
      if (blockedPreviewRef.current?.phase === 'dragging') {
        setBlockedPreview(null)
      }
      return
    }

    event.preventDefault()

    if (blockedPreviewTimerRef.current != null) {
      window.clearTimeout(blockedPreviewTimerRef.current)
      blockedPreviewTimerRef.current = null
    }

    const {message} = getBlockedStageMessage(nextStage.key, progress, generationError)
    const dragMagnitude = Math.min(1, Math.max(0, (absX - 8) / (RESULT_BLOCKED_DRAG_LIMIT - 8)))
    const offsetX = (direction === 'left' ? -1 : 1) *
      Math.min(RESULT_BLOCKED_DRAG_LIMIT, absX * 0.48)

    setBlockedPreview({
      stageKey: nextStage.key,
      message,
      direction,
      phase: 'dragging',
      offsetX,
      progress: dragMagnitude,
    })
  }, [generationError, progress, stageAvailability, stageIndex])

  const handleStageTouchEnd = useCallback((event: TouchEvent) => {
    const start = touchStartRef.current
    const touch = event.changedTouches[0]
    const preview = blockedPreviewRef.current
    touchStartRef.current = null

    if (!start || !touch) {
      if (preview?.phase === 'dragging') {
        settleBlockedPreview(preview.stageKey, preview.direction)
      }
      return
    }

    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    const absX = Math.abs(deltaX)
    const absY = Math.abs(deltaY)

    if (absX < RESULT_STAGE_SWIPE_THRESHOLD || absX < absY * 1.25) {
      if (preview?.phase === 'dragging') {
        settleBlockedPreview(preview.stageKey, preview.direction)
      }
      return
    }

    const direction: StageMotionDirection = deltaX < 0 ? 'left' : 'right'
    const nextIndex = stageIndex + (direction === 'left' ? 1 : -1)
    const nextStage = RESULT_STAGES[nextIndex]

    if (nextStage && !stageAvailability[nextStage.key]) {
      settleBlockedPreview(nextStage.key, direction)
      requestStageSwitch(nextIndex, {
        direction,
        showBubble: false,
      })
      return
    }

    requestStageSwitch(nextIndex, {
      shake: true,
      direction,
    })
  }, [requestStageSwitch, settleBlockedPreview, stageAvailability, stageIndex])

  const handleStageTouchCancel = useCallback(() => {
    touchStartRef.current = null
    const preview = blockedPreviewRef.current
    if (preview?.phase === 'dragging') {
      settleBlockedPreview(preview.stageKey, preview.direction)
    }
  }, [settleBlockedPreview])

  const handleReturnHome = useCallback(() => {
    if (!enteredFromCard) {
      handleBackHome()
      return
    }

    if (isReturningHome) {
      return
    }

    const cardOpenSnapshot = readCardOpenRect()
    const returningCardId = returnCard?.id ?? cardOpenSnapshot?.cardId ?? null
    const rootElement = rootRef.current
    const shellElement = rootElement?.querySelector('.reffo-result__shell') as HTMLElement | null
    const chromeElement = rootElement?.querySelector('.reffo-result__chrome') as HTMLElement | null
    let finished = false

    const finishReturn = () => {
      if (finished) {
        return
      }

      finished = true
      if (returnTimerRef.current != null) {
        window.clearTimeout(returnTimerRef.current)
        returnTimerRef.current = null
      }
      suppressNextNavigationTransition()
      handleBackHome()
    }

    const didStartViewTransition = startResultCardReturnTransition(() => {
      markReturningHome(returningCardId, 'view-transition')
      return handleBackHome()
    }, rootElement)

    if (didStartViewTransition) {
      return
    }

    markReturningHome(returningCardId)
    setIsReturningHome(true)

    if (returnTimerRef.current != null) {
      window.clearTimeout(returnTimerRef.current)
    }

    returnTimerRef.current = window.setTimeout(finishReturn, 48)

    const fadingElements = [shellElement, chromeElement]

    fadingElements.forEach(element => {
      element?.animate?.(
        [
          {opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)'},
          {opacity: 0, transform: 'translate3d(0, -8px, 0) scale(0.98)'},
        ],
        {
          duration: 260,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          fill: 'forwards',
        },
      )
    })
  }, [enteredFromCard, handleBackHome, isReturningHome, returnCard])

  const handleAction = async () => {
    if (enteredFromCard) {
      handleReturnHome()
      return
    }

    if (!isComplete) {
      handleBackHome()
      return
    }

    await handleComplete()
  }

  if (loading || !result) {
    return (
      <View
        className={classNames('reffo-result', 'reffo-result--loading', {
          'reffo-result--from-card': enteredFromCard,
          'reffo-result--from-generation': !enteredFromCard,
          'reffo-result--from-card-ready': enteredFromCard && isFromCardReady,
          'reffo-result--from-landing': enteredFromLanding,
          'reffo-result--returning-home': isReturningHome,
        })}
      >
        {enteredFromLanding && !hideLandingHeader ? (
          <LandingFlowHeader
            className='reffo-create__landing-header--result'
            onBack={() => {
              void handleComplete()
            }}
            onSkip={handleBackHome}
            progressStep={3}
            backLabel='完成'
          />
        ) : null}
        <Text className='reffo-result__loading-text'>{loading ? '加载中...' : '未找到结果'}</Text>
      </View>
    )
  }

  return (
    <View
      ref={rootRef as any}
      className={classNames('reffo-result', {
        'reffo-result--progress-complete': isComplete,
        'reffo-result--from-card': enteredFromCard,
        'reffo-result--from-generation': !enteredFromCard,
        'reffo-result--from-landing': enteredFromLanding,
        'reffo-result--from-card-ready': enteredFromCard && isFromCardReady,
        'reffo-result--edge-enter-ready': enteredFromCard && isEdgeEnterReady,
        'reffo-result--returning-home': isReturningHome,
        'reffo-result--blocked-shake': isBlockedShaking,
        'reffo-result--blocked-preview': Boolean(blockedPreview),
        'reffo-result--blocked-dragging': blockedPreview?.phase === 'dragging',
        'reffo-result--blocked-settling': blockedPreview?.phase === 'settling',
        [`reffo-result--blocked-to-${blockedPreview?.direction}`]: Boolean(blockedPreview),
      })}
      style={resultStyle}
      onTouchStart={handleStageTouchStart}
      onTouchMove={handleStageTouchMove}
      onTouchEnd={handleStageTouchEnd}
      onTouchCancel={handleStageTouchCancel}
    >
      {enteredFromLanding ? (
        hideLandingHeader ? null : (
          <LandingFlowHeader
            className='reffo-create__landing-header--result'
            onBack={() => {
              void handleComplete()
            }}
            onSkip={handleBackHome}
            progressStep={3}
            backLabel='完成'
          />
        )
      ) : enteredFromCard ? (
        <>
          <View className='reffo-result__chrome reffo-result__chrome--back'>
            <View className='reffo-result__action reffo-result__action--back' onClick={handleReturnHome}>
              <Image src={exitIcon} className='reffo-result__action-icon' mode='aspectFit' />
              <Text>返回</Text>
            </View>
          </View>
          {canEditHistory ? (
            <View className='reffo-result__chrome'>
              <View
                className='reffo-result__action reffo-result__action--edit'
                onClick={() => {
                  void handleEditHistory()
                }}
              >
                <Image src={editIcon} className='reffo-result__action-icon' mode='aspectFit' />
                <Text>编辑简历</Text>
              </View>
            </View>
          ) : null}
        </>
      ) : (
        <View className='reffo-result__chrome'>
          <View
            className={classNames('reffo-result__action', {
              'reffo-result__action--edit': isComplete && canEditHistory,
            })}
            onClick={isComplete && canEditHistory
              ? () => {
                  void handleEditHistory()
                }
              : handleAction}
          >
            {!isComplete ? (
              <Image src={exitIcon} className='reffo-result__action-icon' mode='aspectFit' />
            ) : canEditHistory ? (
              <Image src={editIcon} className='reffo-result__action-icon' mode='aspectFit' />
            ) : null}
            <Text>{isComplete && canEditHistory ? '编辑简历' : isComplete ? '完成' : '退出生成'}</Text>
          </View>
        </View>
      )}

      <View className='reffo-result__blocked-underlay' aria-hidden='true'>
        <View className='reffo-result__blocked-card'>
          <View className='reffo-result__blocked-loader'>
            <View className='reffo-result__blocked-loader-dot' />
          </View>
          <Text className='reffo-result__blocked-stage'>
            {blockedPreviewStage?.label ?? '下一步'}
          </Text>
          <Text className='reffo-result__blocked-message'>
            {blockedPreview?.message ?? '步骤正在生成中'}
          </Text>
        </View>
      </View>

      <View className='reffo-result__shell'>
        <View className='reffo-result__content'>
          <View className='reffo-result__header'>
            <View className='reffo-result__title-viewport'>
              {stageTransition ? (
                <>
                  <View
                    key={`stage-title-${stageTransition.id}-from-${stageTransition.fromIndex}`}
                    className={classNames(
                      'reffo-result__motion-item',
                      'reffo-result__motion-item--exit',
                      `reffo-result__motion-item--to-${stageTransition.direction}`,
                    )}
                  >
                    <ResultStageTitle stage={RESULT_STAGES[stageTransition.fromIndex] ?? activeStage} />
                  </View>
                  <View
                    key={`stage-title-${stageTransition.id}-to-${stageTransition.toIndex}`}
                    className={classNames(
                      'reffo-result__motion-item',
                      'reffo-result__motion-item--enter',
                      `reffo-result__motion-item--to-${stageTransition.direction}`,
                    )}
                  >
                    <ResultStageTitle stage={RESULT_STAGES[stageTransition.toIndex] ?? activeStage} />
                  </View>
                </>
              ) : (
                <View
                  key={`stage-title-stable-${activeStage.key}`}
                  className='reffo-result__motion-item reffo-result__motion-item--stable'
                >
                  <ResultStageTitle stage={activeStage} />
                </View>
              )}
            </View>
            <View className='reffo-result__stage-switcher'>
              {readyStages.length > 0 ? (
                <View
                  className='reffo-result__tabs'
                  style={{
                    '--reffo-result-ready-count': readyStages.length,
                    '--reffo-result-active-ready-offset': `${activeReadyIndex * 100}%`,
                    '--reffo-result-tabs-width': `${readyStages.length * 55 + 8}px`,
                  } as CSSProperties}
                >
                  <View className='reffo-result__tab-indicator' />
                  {readyStages.map(stage => {
                    const index = RESULT_STAGES.findIndex(item => item.key === stage.key)
                    const stageStatus = getVisibleStageStatus(stage.key, progress)

                    return (
                      <View
                        key={stage.key}
                        className={classNames('reffo-result__tab', {
                          [`reffo-result__tab--${stage.key}`]: true,
                          'reffo-result__tab--active': index === stageIndex,
                          'reffo-result__tab--ready': stageStatus === 'ready' && index !== stageIndex,
                        })}
                        onClick={() => requestStageSwitch(index)}
                        aria-label={stage.label}
                      >
                        <Image
                          className='reffo-result__tab-icon'
                          src={stage.icon}
                          mode='aspectFit'
                        />
                      </View>
                    )
                  })}
                </View>
              ) : null}

              {blockedStages.map(stage => {
                const index = RESULT_STAGES.findIndex(item => item.key === stage.key)
                const stageStatus = getVisibleStageStatus(stage.key, progress)

                return (
                  <View
                    key={stage.key}
                    className={classNames('reffo-result__tab', 'reffo-result__tab--outside', {
                      [`reffo-result__tab--${stage.key}`]: true,
                      'reffo-result__tab--generating': stageStatus === 'generating',
                      'reffo-result__tab--pending': stageStatus === 'pending',
                      'reffo-result__tab--blocked-bubble': blockedBubble?.stageKey === stage.key,
                    })}
                    onClick={() => requestStageSwitch(index)}
                    aria-label={stage.label}
                  >
                    <Image
                      className='reffo-result__tab-icon'
                      src={stage.icon}
                      mode='aspectFit'
                    />
                    {blockedBubble?.stageKey === stage.key ? (
                      <FeedbackBubble placement='bottom' arrow='top-right'>
                        {blockedBubble.message}
                      </FeedbackBubble>
                    ) : null}
                  </View>
                )
              })}
            </View>
          </View>

          <View className='reffo-result__subtitle-viewport'>
            {stageTransition ? (
              <>
                <View
                  key={`stage-subtitle-${stageTransition.id}-from-${stageTransition.fromIndex}`}
                  className={classNames(
                    'reffo-result__motion-item',
                    'reffo-result__motion-item--exit',
                    `reffo-result__motion-item--to-${stageTransition.direction}`,
                  )}
                >
                  <Text className='reffo-result__subtitle'>
                    {(RESULT_STAGES[stageTransition.fromIndex] ?? activeStage).subtitle}
                  </Text>
                </View>
                <View
                  key={`stage-subtitle-${stageTransition.id}-to-${stageTransition.toIndex}`}
                  className={classNames(
                    'reffo-result__motion-item',
                    'reffo-result__motion-item--enter',
                    `reffo-result__motion-item--to-${stageTransition.direction}`,
                  )}
                >
                  <Text className='reffo-result__subtitle'>
                    {(RESULT_STAGES[stageTransition.toIndex] ?? activeStage).subtitle}
                  </Text>
                </View>
              </>
            ) : (
              <View
                key={`stage-subtitle-stable-${activeStage.key}`}
                className='reffo-result__motion-item reffo-result__motion-item--stable'
              >
                <Text className='reffo-result__subtitle'>
                  {activeStage.subtitle}
                </Text>
              </View>
            )}
          </View>
        </View>

        <View className='reffo-result__scroll-shell'>
          <View className='reffo-result__scroll-fade' />
          <View className='reffo-result__scroll-bottom-fade' />
          <ScrollView
            scrollY
            className='reffo-result__scroll'
            onTouchStart={handleStageTouchStart}
            onTouchMove={handleStageTouchMove}
            onTouchEnd={handleStageTouchEnd}
            onTouchCancel={handleStageTouchCancel}
          >
            <View className='reffo-result__body'>
              <View className='reffo-result__stage-panel-viewport'>
                {stageTransition ? (
                  <>
                    <View
                      key={`stage-${stageTransition.id}-from-${stageTransition.fromIndex}`}
                      className={classNames(
                        'reffo-result__stage-panel',
                        'reffo-result__stage-panel--exit',
                        `reffo-result__stage-panel--to-${stageTransition.direction}`,
                      )}
                    >
                      <ResultContent
                        stage={RESULT_STAGES[stageTransition.fromIndex]?.key ?? activeStage.key}
                        result={result}
                        resumeContent={resumeContent}
                        jdContent={jdContent}
                        onOptimizedResumeChange={handleOptimizedResumeChange}
                      />
                    </View>
                    <View
                      key={`stage-${stageTransition.id}-to-${stageTransition.toIndex}`}
                      className={classNames(
                        'reffo-result__stage-panel',
                        'reffo-result__stage-panel--enter',
                        `reffo-result__stage-panel--to-${stageTransition.direction}`,
                      )}
                    >
                      <ResultContent
                        stage={RESULT_STAGES[stageTransition.toIndex]?.key ?? activeStage.key}
                        result={result}
                        resumeContent={resumeContent}
                        jdContent={jdContent}
                        onOptimizedResumeChange={handleOptimizedResumeChange}
                      />
                    </View>
                  </>
                ) : (
                  <View
                    key={`stage-stable-${activeStage.key}`}
                    className='reffo-result__stage-panel reffo-result__stage-panel--stable'
                  >
                    <ResultContent
                      stage={activeStage.key}
                      result={result}
                      resumeContent={resumeContent}
                      jdContent={jdContent}
                      onOptimizedResumeChange={handleOptimizedResumeChange}
                    />
                  </View>
                )}
              </View>

              <Text className='reffo-result__disclaimer'>*内容由人工智能生成，请仔细检查</Text>
            </View>
          </ScrollView>
        </View>
      </View>
    </View>
  )
}
