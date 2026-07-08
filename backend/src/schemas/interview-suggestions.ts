import { z } from 'zod'
import type { InterviewSuggestions } from '@/types'

export const interviewStoryRecommendationSchema = z.object({
  title: z.string(),
  background: z.string(),
  result: z.string(),
}).passthrough()

export const interviewSuggestionsSchema = z.object({
  questions: z.array(z.string()),
  story_recommendations: z.array(interviewStoryRecommendationSchema),
  follow_up_questions: z.array(z.string()).default([]),
}).passthrough()

export type InterviewSuggestionsFromSchema = z.infer<typeof interviewSuggestionsSchema>

export function isInterviewSuggestions(value: unknown): value is InterviewSuggestions {
  return interviewSuggestionsSchema.safeParse(value).success
}

export function parseInterviewSuggestions(value: unknown): InterviewSuggestions {
  return interviewSuggestionsSchema.parse(value) as InterviewSuggestions
}
