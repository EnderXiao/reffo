import { test, expect } from 'bun:test'
import { EntryJsonStream, EntryPreviewJournal } from '@/v5/writing/entry-stream'
import { boundedMap } from '@/v5/bounded-map'

const entry = { entryId: 'entry:0', paragraphs: [{ role: 'problem', text: '含有 }、[ 和 "引号"，路径 \\，换行转义\n字符。', evidenceIds: ['a'] }] }
const json = JSON.stringify({ contractVersion: 'entry-writing-v1', entries: [entry] })
test('every possible two-chunk split and single-character chunks yield one complete entry', () => {
  for (let index = 0; index <= json.length; index++) {
    const result: unknown[] = [], parser = new EntryJsonStream(value => result.push(value))
    parser.push(json.slice(0, index)); parser.push(json.slice(index))
    expect(result).toEqual([entry])
  }
  const result: unknown[] = [], parser = new EntryJsonStream(value => result.push(value))
  for (const char of json) parser.push(char)
  expect(result).toEqual([entry])
})
test('incomplete objects and unrelated nested entries are not emitted', () => {
  const result: unknown[] = [], parser = new EntryJsonStream(value => result.push(value))
  parser.push(json.slice(0, -3))
  expect(result).toEqual([])
  new EntryJsonStream(value => result.push(value)).push(JSON.stringify({ source: { contractVersion: 'entry-writing-v1', entries: [entry] } }))
  expect(result).toEqual([])
})
test('malformed or oversized previews do not crash or create partial results', () => {
  const result: unknown[] = []
  new EntryJsonStream(value => result.push(value), 10).push(json)
  new EntryJsonStream(value => result.push(value)).push('{]')
  expect(result).toEqual([])
})
test('journal has stable cursors, deduplicates previews, and separates failure from completion', () => {
  const journal = new EntryPreviewJournal('run', () => { throw new Error('disconnected viewer') })
  journal.preview('b', 2, ['b']); journal.preview('a', 1, ['a']); journal.preview('a', 1, ['different'])
  const first = journal.replay('run', 0)
  expect(first.map(e => e.sequence)).toEqual([1, 2, 3])
  expect(journal.replay('run', 2)).toHaveLength(1)
  expect(() => journal.replay('other-run', 0)).toThrow()
  expect(() => journal.replay('run', 99)).toThrow()
  journal.finish(false); journal.finish(true); journal.preview('c', 3, ['c'])
  expect(journal.replay('run', 3).map(e => e.type)).toEqual(['writer.failed'])
})
test('bounded workers refill without waiting for a slow batch and preserve input order', async () => {
  let release!: () => void
  const slow = new Promise<void>(resolve => { release = resolve })
  const started: number[] = []
  const result = boundedMap([0, 1, 2], 2, async n => {
    started.push(n)
    if (n === 0) await slow
    if (n === 2) release()
    return n
  })
  expect(await result).toEqual([0, 1, 2])
  expect(started).toEqual([0, 1, 2])
})
test('failure drains in-flight work and stops scheduling more requests', async () => {
  let active = 0
  const started: number[] = []
  await expect(boundedMap([0, 1, 2, 3], 2, async n => {
    active++; started.push(n)
    await Promise.resolve()
    active--
    if (n === 0) throw new Error('failed')
    return n
  })).rejects.toThrow('failed')
  expect(active).toBe(0)
  expect(started).toEqual([0, 1])
})
