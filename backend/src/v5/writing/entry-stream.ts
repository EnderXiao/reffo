import { writtenEntrySchema, type WrittenEntry } from '@/v5/writing/entries'

/** Frames only complete objects in the root entries array; braces inside JSON
 * strings, escapes, and arbitrary network chunk boundaries are not delimiters. */
export class EntryJsonStream {
  private buffer = ''
  private stack: string[] = []
  private inString = false
  private escaped = false
  private entriesArray = false
  private start = -1
  private disabled = false
  constructor(private readonly receive: (entry: WrittenEntry) => void, private readonly maxCharacters = 2_000_000) {}

  push(delta: string) {
    if (this.disabled) return
    const offset = this.buffer.length
    if (offset + delta.length > this.maxCharacters) { this.disabled = true; this.buffer = ''; return }
    this.buffer += delta
    for (let i = offset; i < this.buffer.length; i++) {
      const char = this.buffer[i]
      if (this.inString) {
        if (this.escaped) this.escaped = false
        else if (char === '\\') this.escaped = true
        else if (char === '"') this.inString = false
        continue
      }
      if (char === '"') { this.inString = true; continue }
      if (char === '{' || char === '[') {
        if (char === '[' && this.stack.length === 1 && /"entries"\s*:\s*$/u.test(this.buffer.slice(0, i))) {
          try {
            const prefix = JSON.parse(this.buffer.slice(0, i) + '[]}')
            this.entriesArray = prefix.contractVersion === 'entry-writing-v1'
          } catch { this.entriesArray = false }
        }
        if (char === '{' && this.entriesArray && this.stack.length === 2) this.start = i
        this.stack.push(char)
      } else if (char === '}' || char === ']') {
        const expected = char === '}' ? '{' : '['
        if (this.stack.pop() !== expected) { this.disabled = true; return }
        if (char === '}' && this.entriesArray && this.stack.length === 2 && this.start >= 0) {
          const framed = this.buffer.slice(this.start, i + 1)
          this.start = -1
          try {
            const parsed = writtenEntrySchema.safeParse(JSON.parse(framed))
            if (parsed.success) this.receive(parsed.data)
          } catch { /* Previews are optional; final parsing decides validity. */ }
        }
        if (char === ']' && this.stack.length === 1) this.entriesArray = false
      }
    }
  }
}

export type EntryStreamEvent = {
  runId: string; sequence: number
} & ({ type: 'writer.started' } | { type: 'entry.preview'; entryId: string; order: number; paragraphs: string[] }
  | { type: 'writer.completed' } | { type: 'writer.failed' })

/** Per-run in-memory preview journal, never the general audit bus. A consumer
 * reconnects with its run-scoped cursor; reading/replay does not invoke an LLM. */
export class EntryPreviewJournal {
  private events: EntryStreamEvent[] = []
  private seen = new Set<string>()
  private terminal = false
  constructor(readonly runId: string, private readonly receive?: (event: EntryStreamEvent) => void) {
    this.emit({ type: 'writer.started' })
  }
  private emit(event: Omit<EntryStreamEvent, 'runId' | 'sequence'>) {
    const value = { ...event, runId: this.runId, sequence: this.events.length + 1 } as EntryStreamEvent
    this.events.push(value)
    try { this.receive?.(structuredClone(value)) } catch { /* Observer failure must not retry generation. */ }
  }
  preview(entryId: string, order: number, paragraphs: string[]) {
    if (this.terminal || this.seen.has(entryId) || this.seen.size >= 100) return
    this.seen.add(entryId)
    this.emit({ type: 'entry.preview', entryId, order, paragraphs } as Omit<EntryStreamEvent, 'runId' | 'sequence'>)
  }
  finish(success: boolean) {
    if (this.terminal) return
    this.terminal = true
    this.emit({ type: success ? 'writer.completed' : 'writer.failed' })
  }
  replay(runId: string, afterSequence: number): EntryStreamEvent[] {
    if (runId !== this.runId || !Number.isSafeInteger(afterSequence) || afterSequence < 0 || afterSequence > this.events.length) throw new Error('STREAM_CURSOR_INVALID')
    return structuredClone(this.events.filter(event => event.sequence > afterSequence))
  }
}
