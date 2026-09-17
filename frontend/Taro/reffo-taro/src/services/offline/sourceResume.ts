import type {SourceResumeSourceType, SourceResumeSummary} from '@/types'
import {getJSON, setJSON, storage} from '@/utils/storage'

export interface SaveSourceResumeRequest {
  title: string
  resume_markdown: string
  source_type: SourceResumeSourceType
  original_file_name?: string | null
}

const SOURCE_RESUME_KEY = 'latest_source_resume'

export class SourceResumeApi {
  async saveSourceResume(payload: SaveSourceResumeRequest): Promise<SourceResumeSummary> {
    const now = new Date().toISOString()
    const previous = await getJSON<SourceResumeSummary>(SOURCE_RESUME_KEY)
    const record: SourceResumeSummary = {
      id: previous?.id || `local-source-${Date.now()}`,
      title: payload.title,
      resumeMarkdown: payload.resume_markdown,
      sourceType: payload.source_type,
      originalFileName: payload.original_file_name || null,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
    }

    await setJSON(SOURCE_RESUME_KEY, record)
    return record
  }

  async getLatestSourceResume(): Promise<SourceResumeSummary | null> {
    return getJSON<SourceResumeSummary>(SOURCE_RESUME_KEY)
  }

  async deleteSourceResume(_id: string): Promise<void> {
    await storage.removeItem(SOURCE_RESUME_KEY)
  }
}

export const sourceResumeApi = new SourceResumeApi()
