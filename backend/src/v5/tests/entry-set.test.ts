import { expect, spyOn, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { env } from '@/config/env'
import { createHarnessEvent } from '@/harness/events'
import { logHarnessEvent } from '@/harness/subscribers/log-subscriber'
import { PersistenceSubscriber } from '@/harness/subscribers/persistence-subscriber'
import { initializeHarnessDatabase } from '@/repositories/database'
import { inspectEntrySet } from '@/v5/writing/entry-set'

test('entry diagnostics persist and log only structural IDs or redacted digests', async () => {
  const previous = env.DATABASE_PROVIDER
  env.DATABASE_PROVIDER = 'sqlite'
  const db = initializeHarnessDatabase(new Database(':memory:'))
  const subscriber = new PersistenceSubscriber(() => db)
  const log = spyOn(console, 'log').mockImplementation(() => {})
  const privateText = '不应存储的简历正文和联系方式'
  const diagnostics = inspectEntrySet(['entry:0', 'entry:1'], ['entry:1', privateText, 'entry:1'])
  const event = createHarnessEvent({ type: 'writing.validation.observed', runId: 'entry-run',
    requestId: 'entry-request', stepRunId: 'entry-step', attemptId: 'entry-attempt',
    payload: { version: 'entry-set-v1', code: 'ENTRY_SET_INVALID', ...diagnostics } })
  try {
    await subscriber.handle(event)
    logHarnessEvent(event)
    const row = db.query('SELECT payload_json FROM harness_events WHERE run_id = ?').get('entry-run') as { payload_json: string }
    expect(JSON.parse(row.payload_json)).toMatchObject({ expectedCount: 2, actualCount: 3,
      missingIds: ['entry:0'], duplicateIds: ['entry:1'], unknownIds: [expect.stringMatching(/^invalid:[a-f0-9]{16}$/)] })
    expect(row.payload_json).not.toContain(privateText)
    expect(log).toHaveBeenCalledTimes(1)
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ type: event.type, payload: JSON.parse(row.payload_json) })
    expect(inspectEntrySet(['entry:0'], Array(101).fill(privateText)).actualIds).toHaveLength(100)
  } finally { log.mockRestore(); db.close(); env.DATABASE_PROVIDER = previous }
})
