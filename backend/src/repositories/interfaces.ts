import type { RequestUserContext } from '@/auth/request-context'
import type {
  ResumeHistoryRecord,
  SaveResumeHistoryInput,
  SaveSourceResumeInput,
  SourceResumeRecord,
  UpdateResumeHistoryInput,
} from '@/types'

export interface SourceResumeRepositoryContract {
  save(context: RequestUserContext, input: SaveSourceResumeInput): Promise<SourceResumeRecord> | SourceResumeRecord
  getLatest(context: RequestUserContext): Promise<SourceResumeRecord | null> | SourceResumeRecord | null
  delete(context: RequestUserContext, id: string): Promise<boolean> | boolean
}

export interface ResumeHistoryRepositoryContract {
  save(context: RequestUserContext, input: SaveResumeHistoryInput): Promise<ResumeHistoryRecord> | ResumeHistoryRecord
  list(context: RequestUserContext, limit?: number): Promise<ResumeHistoryRecord[]> | ResumeHistoryRecord[]
  findById(context: RequestUserContext, id: string): Promise<ResumeHistoryRecord | null> | ResumeHistoryRecord | null
  update(
    context: RequestUserContext,
    id: string,
    updates: UpdateResumeHistoryInput
  ): Promise<ResumeHistoryRecord | null> | ResumeHistoryRecord | null
  delete(context: RequestUserContext, id: string): Promise<boolean> | boolean
  clear(context: RequestUserContext): Promise<number> | number
}
