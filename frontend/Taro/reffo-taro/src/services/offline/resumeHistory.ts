import type {ResumeHistory} from '@/types'
import {getJSON, setJSON, storage} from '@/utils/storage'

const HISTORY_KEY = 'resume_histories'

async function readHistories(): Promise<ResumeHistory[]> {
  const histories = await getJSON<ResumeHistory[]>(HISTORY_KEY)
  return Array.isArray(histories) ? histories : []
}

async function writeHistories(histories: ResumeHistory[]): Promise<void> {
  await setJSON(HISTORY_KEY, histories)
}

export class ResumeHistoryApi {
  async getHistories(): Promise<ResumeHistory[]> {
    return readHistories()
  }

  async getHistory(id: string): Promise<ResumeHistory> {
    const history = (await readHistories()).find(item => item.id === id)
    if (!history) {
      throw new Error(`历史记录不存在: ${id}`)
    }
    return history
  }

  async saveHistory(history: ResumeHistory): Promise<ResumeHistory> {
    const histories = await readHistories()
    const next = histories.filter(item => item.id !== history.id)
    next.unshift(history)
    await writeHistories(next)
    return history
  }

  async updateHistory(id: string, updates: Partial<ResumeHistory>): Promise<ResumeHistory> {
    const histories = await readHistories()
    const index = histories.findIndex(item => item.id === id)
    if (index === -1) {
      throw new Error(`历史记录不存在: ${id}`)
    }

    const updated = {
      ...histories[index],
      ...updates,
    }
    histories[index] = updated
    await writeHistories(histories)
    return updated
  }

  async deleteHistory(id: string): Promise<void> {
    await writeHistories((await readHistories()).filter(item => item.id !== id))
  }

  async deleteAllHistories(): Promise<void> {
    await storage.removeItem(HISTORY_KEY)
  }

  async clearHistories(): Promise<void> {
    await storage.removeItem(HISTORY_KEY)
  }
}

export const resumeHistoryApi = new ResumeHistoryApi()
