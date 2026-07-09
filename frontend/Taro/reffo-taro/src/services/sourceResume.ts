import {apiClient, hasConfiguredApiBaseURL} from './api';
import type {SourceResumeSourceType, SourceResumeSummary} from '@/types';

interface SourceResumeApiRecord {
  id: string;
  title: string;
  resume_markdown: string;
  source_type: SourceResumeSourceType;
  original_file_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface SaveSourceResumeRequest {
  title: string;
  resume_markdown: string;
  source_type: SourceResumeSourceType;
  original_file_name?: string | null;
}

function toSourceResumeSummary(record: SourceResumeApiRecord): SourceResumeSummary {
  return {
    id: record.id,
    title: record.title,
    resumeMarkdown: record.resume_markdown,
    sourceType: record.source_type,
    originalFileName: record.original_file_name,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

export class SourceResumeApi {
  async saveSourceResume(payload: SaveSourceResumeRequest): Promise<SourceResumeSummary> {
    const response = await apiClient.post<SourceResumeApiRecord>('/source-resume', payload);
    return toSourceResumeSummary(response);
  }

  async getLatestSourceResume(): Promise<SourceResumeSummary | null> {
    if (!hasConfiguredApiBaseURL() && process.env.NODE_ENV === 'production') {
      return null;
    }

    const response = await apiClient.get<SourceResumeApiRecord | null>('/source-resume/latest');
    return response ? toSourceResumeSummary(response) : null;
  }

  async deleteSourceResume(id: string): Promise<void> {
    await apiClient.delete(`/source-resume/${encodeURIComponent(id)}`);
  }
}

export const sourceResumeApi = new SourceResumeApi();
