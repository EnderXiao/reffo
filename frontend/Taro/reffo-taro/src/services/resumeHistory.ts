import {apiClient} from './api';
import type {ResumeHistory} from '@/types';

interface ResumeHistoryApiRecord {
  id: string;
  position: string;
  company: string;
  name: string;
  created_at: string;
  updated_at: string;
  quality_score: number;
  match_score: number;
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
}

type ResumeHistoryApiPayload = Omit<ResumeHistoryApiRecord, 'id' | 'updated_at'> & {
  id?: string | null;
};

type ResumeHistoryApiUpdatePayload = Partial<Omit<ResumeHistoryApiPayload, 'id'>>;

function toApiPayload(history: ResumeHistory): ResumeHistoryApiPayload {
  return {
    id: history.id || null,
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
    ...(history.resultContext ? {result_context: history.resultContext} : {}),
    ...(history.progress ? {progress: history.progress} : {}),
    ...(history.cardColor ? {card_color: history.cardColor} : {}),
    ...(history.cardPattern ? {card_pattern: history.cardPattern} : {}),
  };
}

function toApiUpdatePayload(updates: Partial<ResumeHistory>): ResumeHistoryApiUpdatePayload {
  return {
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
    ...(updates.resultContext !== undefined ? {result_context: updates.resultContext} : {}),
    ...(updates.progress !== undefined ? {progress: updates.progress} : {}),
    ...(updates.cardColor !== undefined ? {card_color: updates.cardColor} : {}),
    ...(updates.cardPattern !== undefined ? {card_pattern: updates.cardPattern} : {}),
  };
}

function toResumeHistory(record: ResumeHistoryApiRecord): ResumeHistory {
  return {
    id: record.id,
    position: record.position,
    company: record.company,
    name: record.name,
    createdAt: record.created_at,
    qualityScore: record.quality_score,
    matchScore: record.match_score,
    tags: record.tags,
    resumeContent: record.resume_content,
    jdContent: record.jd_content,
    optimizedContent: record.optimized_content,
    ...(record.optimization_suggestions ? {optimizationSuggestions: record.optimization_suggestions} : {}),
    ...(record.changes_summary ? {changesSummary: record.changes_summary} : {}),
    ...(record.process_result ? {processResult: record.process_result as ResumeHistory['processResult']} : {}),
    ...(record.result_context ? {resultContext: record.result_context as ResumeHistory['resultContext']} : {}),
    ...(record.progress ? {progress: record.progress as ResumeHistory['progress']} : {}),
    ...(record.card_color ? {cardColor: record.card_color} : {}),
    ...(record.card_pattern ? {cardPattern: record.card_pattern} : {}),
  };
}

export class ResumeHistoryApi {
  async getHistories(): Promise<ResumeHistory[]> {
    const response = await apiClient.get<ResumeHistoryApiRecord[]>('/resume-history');
    return response.map(toResumeHistory);
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

  async deleteHistory(id: string): Promise<void> {
    await apiClient.delete(`/resume-history/${encodeURIComponent(id)}`);
  }

  async clearHistories(): Promise<void> {
    await apiClient.delete('/resume-history');
  }
}

export const resumeHistoryApi = new ResumeHistoryApi();
