import {apiClient} from './api';
import {actionContentDigest} from '@/shared/resume-actions';
import type {ResumeCompletionDocument} from '@/shared/resume-completion';
import {normalizeMatching} from './resume';
import type {ResumeHistory, ResumeHistorySummary} from '@/types';

interface ResumeHistoryApiRecord {
  id: string;
  position: string;
  company: string;
  name: string;
  created_at: string;
  updated_at: string;
  quality_score: number;
  match_score: number | null;
  tags: string[];
  resume_content: string;
  jd_content: string;
  optimized_content: string;
  optimization_suggestions?: string[];
  changes_summary?: string[];
  process_result?: unknown;
  result_context?: unknown;
  progress?: unknown;
  card_color?: string;
  card_pattern?: string;
  commit_ack?: ResumeHistory['commitAck'];
}

interface ResumeHistorySummaryApiRecord {
  id: string;
  position: string;
  company: string;
  name: string;
  created_at: string;
  updated_at: string;
  quality_score: number;
  match_score: number | null;
  tags: string[];
  location: string;
  strategy_body: string;
  strategy_title?: string;
  card_color?: string;
  card_pattern?: string;
}

type ResumeHistoryApiPayload = Omit<ResumeHistoryApiRecord, 'id' | 'updated_at'> & {
  id?: string | null;
  completion_edit?: import('@/shared/resume-completion').CompletionEditJournal;
  commit_id?: string;
  expected_document?: NonNullable<ResumeHistory['completionCommit']>['expectedDocument'];
};

type ResumeHistoryApiUpdatePayload = Partial<Omit<ResumeHistoryApiPayload, 'id'>>;

function toApiPayload(history: ResumeHistory): ResumeHistoryApiPayload {
  return {
    id: history.id || null,
    ...(history.completionCommit ? {commit_id: history.completionCommit.commitId, expected_document: history.completionCommit.expectedDocument} : {}),
    position: history.position,
    company: history.company,
    name: history.name,
    created_at: history.createdAt,
    quality_score: history.qualityScore,
    match_score: history.matchScore,
    tags: history.tags,
    resume_content: history.resumeContent,
    jd_content: history.jdContent,
    optimized_content: history.optimizedContent,
    ...(history.optimizationSuggestions ? {optimization_suggestions: history.optimizationSuggestions} : {}),
    ...(history.changesSummary ? {changes_summary: history.changesSummary} : {}),
    ...(history.processResult ? {process_result: history.processResult} : {}),
    ...(history.processResult?.optimized.completion_edit ? {completion_edit: history.processResult.optimized.completion_edit} : {}),
    ...(history.resultContext ? {result_context: history.resultContext} : {}),
    ...(history.progress ? {progress: history.progress} : {}),
    ...(history.cardColor ? {card_color: history.cardColor} : {}),
    ...(history.cardPattern ? {card_pattern: history.cardPattern} : {}),
  };
}

function toApiUpdatePayload(updates: Partial<ResumeHistory>): ResumeHistoryApiUpdatePayload {
  return {
    ...(updates.completionCommit ? {commit_id: updates.completionCommit.commitId, expected_document: updates.completionCommit.expectedDocument} : {}),
    ...(updates.position !== undefined ? {position: updates.position} : {}),
    ...(updates.company !== undefined ? {company: updates.company} : {}),
    ...(updates.name !== undefined ? {name: updates.name} : {}),
    ...(updates.createdAt !== undefined ? {created_at: updates.createdAt} : {}),
    ...(updates.qualityScore !== undefined ? {quality_score: updates.qualityScore} : {}),
    ...(updates.matchScore !== undefined ? {match_score: updates.matchScore} : {}),
    ...(updates.tags !== undefined ? {tags: updates.tags} : {}),
    ...(updates.resumeContent !== undefined ? {resume_content: updates.resumeContent} : {}),
    ...(updates.jdContent !== undefined ? {jd_content: updates.jdContent} : {}),
    ...(updates.optimizedContent !== undefined ? {optimized_content: updates.optimizedContent} : {}),
    ...(updates.optimizationSuggestions !== undefined
      ? {optimization_suggestions: updates.optimizationSuggestions}
      : {}),
    ...(updates.changesSummary !== undefined ? {changes_summary: updates.changesSummary} : {}),
    ...(updates.processResult !== undefined ? {process_result: updates.processResult} : {}),
    ...(updates.processResult?.optimized.completion_edit ? {completion_edit: updates.processResult.optimized.completion_edit} : {}),
    ...(updates.resultContext !== undefined ? {result_context: updates.resultContext} : {}),
    ...(updates.progress !== undefined ? {progress: updates.progress} : {}),
    ...(updates.cardColor !== undefined ? {card_color: updates.cardColor} : {}),
    ...(updates.cardPattern !== undefined ? {card_pattern: updates.cardPattern} : {}),
  };
}

function toResumeHistory(record: ResumeHistoryApiRecord): ResumeHistory {
  const processResult = record.process_result as ResumeHistory['processResult'];
  return {
    id: record.id,
    position: record.position,
    company: record.company,
    name: record.name,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    ...(record.commit_ack ? {commitAck: record.commit_ack} : {}),
    qualityScore: record.quality_score,
    matchScore: record.match_score,
    tags: record.tags,
    resumeContent: record.resume_content,
    jdContent: record.jd_content,
    optimizedContent: record.optimized_content,
    ...(record.optimization_suggestions ? {optimizationSuggestions: record.optimization_suggestions} : {}),
    ...(record.changes_summary ? {changesSummary: record.changes_summary} : {}),
    ...(processResult ? {processResult: {...processResult, matching: normalizeMatching(processResult.matching)}} : {}),
    ...(record.result_context ? {resultContext: record.result_context as ResumeHistory['resultContext']} : {}),
    ...(record.progress ? {progress: record.progress as ResumeHistory['progress']} : {}),
    ...(record.card_color ? {cardColor: record.card_color} : {}),
    ...(record.card_pattern ? {cardPattern: record.card_pattern} : {}),
  };
}

function toResumeHistorySummary(record: ResumeHistorySummaryApiRecord): ResumeHistorySummary {
  return {
    id: record.id,
    position: record.position,
    company: record.company,
    name: record.name,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    qualityScore: record.quality_score,
    matchScore: record.match_score,
    tags: record.tags,
    location: record.location,
    strategyBody: record.strategy_body,
    strategyTitle: record.strategy_title || '优化建议',
    ...(record.card_color ? {cardColor: record.card_color} : {}),
    ...(record.card_pattern ? {cardPattern: record.card_pattern} : {}),
  };
}

export class ResumeHistoryApi {
  async getHistories(): Promise<ResumeHistory[]> {
    const response = await apiClient.get<ResumeHistoryApiRecord[]>('/resume-history');
    return response.map(toResumeHistory);
  }

  async getHistorySummaries(): Promise<ResumeHistorySummary[]> {
    const response = await apiClient.get<ResumeHistorySummaryApiRecord[]>('/resume-history/summaries');
    return response.map(toResumeHistorySummary);
  }

  async getHistory(id: string): Promise<ResumeHistory> {
    const response = await apiClient.get<ResumeHistoryApiRecord>(
      `/resume-history/${encodeURIComponent(id)}`,
    );
    return toResumeHistory(response);
  }

  async saveHistory(history: ResumeHistory): Promise<ResumeHistory> {
    const response = await apiClient.post<ResumeHistoryApiRecord>(
      '/resume-history',
      toApiPayload(history),
    );
    return toResumeHistory(response);
  }

  async updateHistory(id: string, updates: Partial<ResumeHistory>): Promise<ResumeHistory> {
    const response = await apiClient.put<ResumeHistoryApiRecord>(
      `/resume-history/${encodeURIComponent(id)}`,
      toApiUpdatePayload(updates),
    );
    return toResumeHistory(response);
  }

  async upgradeCompletion(id: string, document: ResumeCompletionDocument): Promise<ResumeHistory> {
    const response = await apiClient.post<ResumeHistoryApiRecord>(
      `/resume-history/${encodeURIComponent(id)}/completion-upgrade`,
      {expected_document: {documentId: document.documentId, revision: document.revision, digest: actionContentDigest(document)}},
      {header: {'X-Reffo-Completion-Schema': 'resume-completion-v4'}},
    );
    return toResumeHistory(response);
  }

  async deleteHistory(id: string): Promise<void> {
    await apiClient.delete(`/resume-history/${encodeURIComponent(id)}`);
  }

  async clearHistories(): Promise<void> {
    await apiClient.delete('/resume-history');
  }
}

export const resumeHistoryApi = new ResumeHistoryApi();
