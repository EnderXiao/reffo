import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import type {CSSProperties} from 'react'
import {Image, ScrollView, Text, View} from '@tarojs/components'
import classNames from 'classnames'
import type {HardRequirement, ProcessResult} from '@/types'
import HomeScoreCard from '@/components/business/HomeCardDeck/HomeScoreCard.h5'
import {useVisualTier} from '@/utils'
import {suppressNextNavigationTransition} from '@/utils/navigation-transition'
import {resolveResumeGrade} from '@/utils/score-grade'
import type {ResultPageViewModel} from './usePageModel'
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
const CARD_OPEN_RECT_STORAGE_KEY = 'reffo.homeCardOpenRect'
const RESULT_RETURN_HOME_DELAY = 760
const RESULT_RETURN_HOME_STORAGE_KEY = 'reffo.resultReturnHome'
const RESULT_RETURN_HOME_DOM_KEY = 'reffoReturnHomePending'
const RESULT_EDGE_ENTER_DELAY = 320
const HOME_CARD_DESIGN_WIDTH = 210
const HOME_CARD_DESIGN_HEIGHT = 332

interface CardOpenRectSnapshot {
  cardId?: string
  left: number
  top: number
  width: number
  height: number
  viewportWidth?: number
  viewportHeight?: number
}

interface ResultStage {
  key: ResultStageKey
  title: string
  accent: string
  label: string
  subtitle: string
  icon: string
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
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.sessionStorage?.getItem(CARD_OPEN_RECT_STORAGE_KEY)

    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Partial<CardOpenRectSnapshot>
    const isValid = [parsed.left, parsed.top, parsed.width, parsed.height].every(value => (
      typeof value === 'number' && Number.isFinite(value)
    ))

    return isValid ? parsed as CardOpenRectSnapshot : null
  } catch (error) {
    console.warn('读取卡片过渡位置失败:', error)
    return null
  }
}

function resolveReturnStyle(): CSSProperties {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {}
  }

  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 393
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 852
  const snapshot = readCardOpenRect()
  const widthRatio = snapshot?.viewportWidth ? viewportWidth / snapshot.viewportWidth : 1
  const heightRatio = snapshot?.viewportHeight ? viewportHeight / snapshot.viewportHeight : 1
  const targetWidth = Math.max(1, (snapshot?.width ?? Math.min(viewportWidth * 0.55, 218)) * widthRatio)
  const targetHeight = Math.max(1, (snapshot?.height ?? targetWidth * 1.546) * heightRatio)
  const targetLeft = snapshot ? snapshot.left * widthRatio : (viewportWidth - targetWidth) / 2
  const targetTop = snapshot ? snapshot.top * heightRatio : Math.max(96, (viewportHeight - targetHeight) / 2)
  const targetCenterX = targetLeft + targetWidth / 2
  const targetCenterY = targetTop + targetHeight / 2
  const startScale = Math.max(
    viewportWidth / Math.max(targetWidth, 1),
    viewportHeight / Math.max(targetHeight, 1),
  ) * 1.08

  return {
    '--reffo-result-return-x': `${targetCenterX - viewportWidth / 2}px`,
    '--reffo-result-return-y': `${targetCenterY - viewportHeight / 2}px`,
    '--reffo-result-return-start-x': `${viewportWidth / 2 - targetCenterX}px`,
    '--reffo-result-return-start-y': `${viewportHeight / 2 - targetCenterY}px`,
    '--reffo-result-return-start-scale': String(startScale),
    '--reffo-result-return-scale-x': String(targetWidth / viewportWidth),
    '--reffo-result-return-scale-y': String(targetHeight / viewportHeight),
    '--reffo-result-return-left': `${targetLeft}px`,
    '--reffo-result-return-top': `${targetTop}px`,
    '--reffo-result-return-width': `${targetWidth}px`,
    '--reffo-result-return-height': `${targetHeight}px`,
    '--card-responsive-scale': String(targetWidth / HOME_CARD_DESIGN_WIDTH),
  } as CSSProperties
}

function clearCardOpenRect() {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage?.removeItem(CARD_OPEN_RECT_STORAGE_KEY)
  } catch (error) {
    console.warn('清理卡片过渡位置失败:', error)
  }
}

function markReturningHome(cardId?: string | null) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage?.setItem(RESULT_RETURN_HOME_STORAGE_KEY, JSON.stringify({cardId: cardId ?? null}))
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

function InterviewPanel({result}: {result: ProcessResult}) {
  const missingSkills = normalizeItems(result.matching.skill_match.missing_skills, 3)
  const unmatchedRequirements = getUnmatchedRequirements(result.matching.hard_requirements_match)
  const strengths = normalizeItems(result.analysis.strengths, 3)
  const generatedQuestions = normalizeItems(result.interview?.questions, 4)
  const fallbackQuestions = [
    ...missingSkills.map(item => `你会如何补齐「${item}」相关经验？`),
    ...unmatchedRequirements.map(item => `针对「${item}」，你准备用什么项目证据回应？`),
  ].slice(0, 2)
  const questions = generatedQuestions.length > 0 ? generatedQuestions : fallbackQuestions
  const story = result.interview?.story_recommendations?.[0]
  const secondaryStory = result.interview?.story_recommendations?.[1]
  const storyTitle = story?.title || strengths[0] || '高匹配项目经历'
  const storyBody = story?.background || strengths[1] || result.analysis.capability_summary || '围绕目标岗位要求，选择最能证明能力迁移的项目经历展开。'
  const storyResult = story?.result || result.optimized.changes_summary[0] || '用量化结果和职责边界说明你的贡献，避免只描述过程。'
  const secondaryStoryTitle = secondaryStory?.title || '补齐短板的备选故事'
  const secondaryStoryBody = secondaryStory?.background || '选择一段能回应岗位关键短板的经历，说明你如何快速学习、协作推进或补齐经验。'
  const secondaryStoryResult = secondaryStory?.result || '强调可验证的交付结果、复盘沉淀或能力迁移，避免只描述主观态度。'
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
        {[
          {title: storyTitle, background: storyBody, result: storyResult},
          {title: secondaryStoryTitle, background: secondaryStoryBody, result: secondaryStoryResult},
        ].map((item, index) => (
          <View key={`${item.title}-${index}`} className='reffo-result__story-block'>
            <Text className='reffo-result__story-title'>{item.title}</Text>
            <Text className='reffo-result__story-source'>
              来自源简历
              <Text className='reffo-result__story-reference'>【引用源简历内容】</Text>
              和岗位描述
              <Text className='reffo-result__story-reference'>【引用岗位描述原文内容】</Text>
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
                • 从岗位描述中 <Text className='reffo-result__story-reference'>【引用岗位描述原文内容】</Text> 推测招聘方看重标准建立能力和处理思路，建议重点阐述。
              </Text>
              <Text className='reffo-result__story-bullet'>
                • 从岗位描述中 <Text className='reffo-result__story-reference'>【引用岗位描述引用引用原文内容】</Text> 推测招聘方不希望候选人不懂业务，建议避开此类描述。
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
  onOptimizedResumeChange,
}: {
  stage: ResultStageKey
  result: ProcessResult
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
  return <InterviewPanel result={result} />
}

export default function PageView({
  result,
  loading,
  progress,
  progressPercent,
  enteredFromCard,
  returnCard,
  handleComplete,
  handleBackHome,
  handlePendingStage,
  handleOptimizedResumeChange,
}: ResultPageViewModel) {
  const visualCapability = useVisualTier({benchmark: true})
  const [stageIndex, setStageIndex] = useState(0)
  const [isFromCardReady, setIsFromCardReady] = useState(!enteredFromCard)
  const [isEdgeEnterReady, setIsEdgeEnterReady] = useState(!enteredFromCard)
  const [isReturningHome, setIsReturningHome] = useState(false)
  const [returnStyle, setReturnStyle] = useState<CSSProperties>({})
  const rootRef = useRef<HTMLElement | null>(null)
  const returnTimerRef = useRef<number | null>(null)
  const edgeEnterTimerRef = useRef<number | null>(null)
  const activeStage = RESULT_STAGES[stageIndex]
  const subtitle = activeStage.subtitle
  const accentIndex = activeStage.title.indexOf(activeStage.accent)
  const titleBeforeAccent = accentIndex >= 0 ? activeStage.title.slice(0, accentIndex) : ''
  const titleAfterAccent = accentIndex >= 0
    ? activeStage.title.slice(accentIndex + activeStage.accent.length)
    : activeStage.title.replace(activeStage.accent, '')
  const backgroundProgress = useMemo(
    () => enteredFromCard ? '100%' : `${progressPercent}%`,
    [enteredFromCard, progressPercent],
  )
  const stageAvailability: Record<ResultStageKey, boolean> = {
    analysis: progress.analysis === 'done',
    resume: progress.optimized === 'done',
    interview: progress.interview === 'done',
  }
  const isComplete = progress.interview === 'done'
  const hasRenderableResult = Boolean(result)
  const resultStyle = useMemo(() => ({
    '--reffo-result-progress': backgroundProgress,
    ...returnStyle,
  }) as CSSProperties, [backgroundProgress, returnStyle])

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
  }, [])

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
    const nextReturnStyle = resolveReturnStyle()
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
      clearCardOpenRect()
      suppressNextNavigationTransition()
      handleBackHome()
    }

    markReturningHome(returningCardId)
    setReturnStyle(nextReturnStyle)
    setIsReturningHome(true)

    if (returnTimerRef.current != null) {
      window.clearTimeout(returnTimerRef.current)
    }

    returnTimerRef.current = window.setTimeout(finishReturn, RESULT_RETURN_HOME_DELAY + 80)

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
          'reffo-result--from-card-ready': enteredFromCard && isFromCardReady,
          'reffo-result--returning-home': isReturningHome,
        })}
        style={returnStyle}
      >
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
        'reffo-result--from-card-ready': enteredFromCard && isFromCardReady,
        'reffo-result--edge-enter-ready': enteredFromCard && isEdgeEnterReady,
        'reffo-result--returning-home': isReturningHome,
      })}
      style={resultStyle}
    >
      {isReturningHome ? (
        <View className='reffo-result__return-layer' style={returnStyle}>
          <View className='reffo-result__return-home-backdrop' />
          {returnCard ? (
            <View className='reffo-result__return-card-stage'>
              <HomeScoreCard
                card={returnCard}
                depth={0}
                active
                visualTier={visualCapability.tier}
                className='reffo-result__return-card'
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {enteredFromCard ? (
        <View className='reffo-result__chrome reffo-result__chrome--back'>
          <View className='reffo-result__action reffo-result__action--back' onClick={handleReturnHome}>
            <Image src={exitIcon} className='reffo-result__action-icon' mode='aspectFit' />
            <Text>返回</Text>
          </View>
        </View>
      ) : (
        <View className='reffo-result__chrome'>
          <View className='reffo-result__action' onClick={handleAction}>
            {!isComplete ? (
              <Image src={exitIcon} className='reffo-result__action-icon' mode='aspectFit' />
            ) : null}
            <Text>{isComplete ? '完成' : '退出生成'}</Text>
          </View>
        </View>
      )}

      <View className='reffo-result__shell'>
        <View className='reffo-result__content'>
          <View className='reffo-result__header'>
            <View>
              {titleBeforeAccent.length > 0 && (
                <Text className='reffo-result__title-prefix'>{titleBeforeAccent}</Text>
              )}
              <Text className='reffo-result__title-accent'>{activeStage.accent}</Text>
              {titleAfterAccent.length > 0 && (
                <Text className='reffo-result__title-prefix'>{titleAfterAccent}</Text>
              )}
              <View className='reffo-result__title-spark' aria-hidden='true'>
                <Text className='reffo-result__title-spark-main'>✦</Text>
                <Text className='reffo-result__title-spark-small'>✦</Text>
              </View>
            </View>
            <View
              className='reffo-result__tabs'
              style={{'--reffo-result-tab-offset': `${stageIndex * 100}%`} as CSSProperties}
            >
              <View className='reffo-result__tab-indicator' />
              {RESULT_STAGES.map((stage, index) => {
                const stageStatus = getVisibleStageStatus(stage.key, progress)

                return (
                  <View
                    key={stage.key}
                    className={classNames('reffo-result__tab', {
                      [`reffo-result__tab--${stage.key}`]: true,
                      'reffo-result__tab--active': index === stageIndex,
                      'reffo-result__tab--ready': stageStatus === 'ready' && index !== stageIndex,
                      'reffo-result__tab--generating': stageStatus === 'generating' && index !== stageIndex,
                      'reffo-result__tab--pending': stageStatus === 'pending' && index !== stageIndex,
                      'reffo-result__tab--disabled': !stageAvailability[stage.key],
                    })}
                    onClick={() => {
                      if (!stageAvailability[stage.key]) {
                        handlePendingStage()
                        return
                      }

                      setStageIndex(index)
                    }}
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
          </View>

          <Text className='reffo-result__subtitle'>
            {subtitle}
          </Text>
        </View>

        <View className='reffo-result__scroll-shell'>
          <View className='reffo-result__scroll-fade' />
          <View className='reffo-result__scroll-bottom-fade' />
          <ScrollView scrollY className='reffo-result__scroll'>
            <View className='reffo-result__body'>
              <ResultContent
                stage={activeStage.key}
                result={result}
                onOptimizedResumeChange={handleOptimizedResumeChange}
              />

              <Text className='reffo-result__disclaimer'>*内容由人工智能生成，请仔细检查</Text>
            </View>
          </ScrollView>
        </View>
      </View>
    </View>
  )
}
