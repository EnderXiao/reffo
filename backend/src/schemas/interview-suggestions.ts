import { z } from 'zod'
import type { InterviewSuggestions } from '@/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeText(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(item => String(item ?? '').trim()).filter(Boolean).join('；')
  }

  return value === null || value === undefined ? '' : String(value).trim()
}

function normalizeTextList(value: unknown) {
  if (!Array.isArray(value)) {
    return typeof value === 'string' && value.trim() ? [value.trim()] : []
  }

  return value
    .map((item) => {
      if (typeof item === 'string') {
        return item.trim()
      }
      if (!isRecord(item)) {
        return ''
      }

      return normalizeText(item.question ?? item.content ?? item.text ?? item.title)
    })
    .filter(Boolean)
}

function normalizeRoot(value: unknown) {
  if (!isRecord(value)) {
    return value
  }

  const root = isRecord(value.interview_suggestions)
    ? value.interview_suggestions
    : isRecord(value.advice)
      ? value.advice
      : value

  return {
    ...root,
    questions: root.questions ?? root.interview_questions ?? [],
    story_recommendations: root.story_recommendations ?? root.stories ?? root.experience_recommendations ?? [],
    follow_up_questions: root.follow_up_questions ?? root.questions_to_ask ?? root.reverse_questions ?? [],
  }
}

function normalizeStory(value: unknown) {
  if (!isRecord(value)) {
    return {
      title: normalizeText(value),
      background: '',
      result: '',
    }
  }

  return {
    ...value,
    title: value.title ?? value.story ?? value.experience ?? value.project ?? value.name ?? '',
    background: value.background ?? value.context ?? value.situation ?? value.description ?? value.action ?? '',
    result: value.result ?? value.outcome ?? value.impact ?? value.key_points ?? value.emphasis ?? '',
  }
}

const textSchema = z.preprocess(normalizeText, z.string())
const textListSchema = z.preprocess(normalizeTextList, z.array(z.string()))

export const interviewStoryRecommendationSchema = z.preprocess(
  normalizeStory,
  z.object({
    title: textSchema,
    background: textSchema,
    result: textSchema,
  })
)

export const interviewSuggestionsSchema = z.preprocess(normalizeRoot, z.object({
  questions: textListSchema.default([]),
  story_recommendations: z.array(interviewStoryRecommendationSchema).default([]),
  follow_up_questions: textListSchema.default([]),
}))

export type InterviewSuggestionsFromSchema = z.infer<typeof interviewSuggestionsSchema>

export function isInterviewSuggestions(value: unknown): value is InterviewSuggestions {
  return interviewSuggestionsSchema.safeParse(value).success
}

export function parseInterviewSuggestions(value: unknown): InterviewSuggestions {
  return interviewSuggestionsSchema.parse(value) as InterviewSuggestions
}
