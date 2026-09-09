import type { V5CheckpointRow, V5CheckpointStorage } from '@/repositories/v5-checkpoint-repository'

export class MemoryCheckpointStorage implements V5CheckpointStorage {
  readonly rows = new Map<string, V5CheckpointRow>()
  async read(id: string, owner: string) {
    const row = this.rows.get(id)
    return row && row.owner_id === owner ? structuredClone(row) : null
  }
  async write(row: V5CheckpointRow) {
    this.rows.set(row.id, structuredClone(row))
  }
  async cleanup() {
    for (const [key, row] of this.rows) if (Date.parse(row.expires_at) <= Date.now()) this.rows.delete(key)
  }
}
