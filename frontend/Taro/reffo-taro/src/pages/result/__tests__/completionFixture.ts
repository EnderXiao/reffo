import {COMPLETION_TEMPLATES, createCompletionDocument, serializeDraft, type ResumeCompletionDocument} from '@/shared/resume-completion'
import type {ProcessResult} from '@/types'

export function completionFixture() {
  return createCompletionDocument({documentId: 'fixture-document', blocks: [{blockId: 'bullet', kind: 'bullet', prefix: '- ', segments: [
    {kind: 'text', segmentId: 'start', markdown: '参与需求梳理', origin: 'generated'},
    {kind: 'optional_gap_clause', gapId: 'deliverable', template: 'design_deliverable', ...COMPLETION_TEMPLATES.design_deliverable,
      candidates: [{text: '页面原型', kind: 'category_example'}], fill: {state: 'empty'}, retainedFacts: []},
    {kind: 'text', segmentId: 'end', markdown: '，支持评审。', origin: 'generated'},
  ]}]})
}

export function completionResult(document: ResumeCompletionDocument = completionFixture()): ProcessResult {
  return {
    analysis: {quality_score: 80, strengths: [], weaknesses: [], suggestions: [], capability_summary: '',
      structured_resume: {personal_info: {name: '测试用户'}, education: [], experience: [], projects: [], skills: {hard_skills: [], soft_skills: []}}},
    matching: {match_score: 80, hard_requirements_match: [], skill_match: {matched_skills: [], missing_skills: [], match_percentage: 80},
      experience_match: {years_required: 0, years_actual: 0, relevant_experience: [], match_percentage: 80}, optimization_suggestions: []},
    optimized: {optimized_resume: serializeDraft(document), completion_document: document, changes_summary: [], improvement_score: 0},
    interview: {questions: [], story_recommendations: [], follow_up_questions: []},
  }
}
