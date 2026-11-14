import {randomUUID} from 'node:crypto'
import {env} from '@/config/env'
import {getDatabase} from '@/repositories/database'
import {createSupabaseRestClient} from '@/repositories/supabase/client'
import type {ChatCompletionInput, ChatCompletionResult} from '@/providers/llm-provider'

export interface ProviderCallEvent {
  id: string
  call_id: string
  event_kind: 'requested' | 'completed' | 'failed'
  run_id: string | null
  step_run_id: string | null
  attempt_id: string | null
  stage: string | null
  provider: string
  model: string
  retry_index: number
  call_reason: string | null
  occurred_at: string
  latency_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  reasoning_tokens: number | null
  provider_request_id: string | null
  error_code: string | null
  expires_at: string
}
export interface ProviderCallEventStorage {append(event: ProviderCallEvent): Promise<void>}
function database() {
  const db = getDatabase()
  db.exec(`CREATE TABLE IF NOT EXISTS provider_calls (id TEXT PRIMARY KEY,call_id TEXT NOT NULL,event_kind TEXT NOT NULL,
    run_id TEXT,step_run_id TEXT,attempt_id TEXT,stage TEXT,provider TEXT NOT NULL,model TEXT NOT NULL,retry_index INTEGER NOT NULL,
    call_reason TEXT,occurred_at TEXT NOT NULL,latency_ms INTEGER,input_tokens INTEGER,output_tokens INTEGER,reasoning_tokens INTEGER,
    provider_request_id TEXT,error_code TEXT,expires_at TEXT NOT NULL,UNIQUE(call_id,event_kind));
    CREATE INDEX IF NOT EXISTS provider_calls_run ON provider_calls(run_id,occurred_at);
    CREATE INDEX IF NOT EXISTS provider_calls_expiry ON provider_calls(expires_at);`)
  return db
}
export const providerCallEventStorage: ProviderCallEventStorage = {
  async append(event) {
    if (env.DATABASE_PROVIDER === 'supabase') {
      await createSupabaseRestClient({useServiceRole: true}).request('/rest/v1/provider_calls', {method: 'POST', body: event, prefer: 'return=minimal'})
      return
    }
    const entries = Object.entries(event)
    database().query(`INSERT INTO provider_calls (${entries.map(([key]) => key).join(',')}) VALUES (${entries.map(() => '?').join(',')})`)
      .run(...entries.map(([, value]) => value))
  },
}
/** Each physical request has immutable requested and terminal events; missing usage stays null. */
export class ProviderCallRecorder {
  constructor(private readonly storage: ProviderCallEventStorage = providerCallEventStorage) {}
  async begin(input: ChatCompletionInput, provider: string, model: string) {
    const callId = randomUUID()
    const started = Date.now()
    const base = {call_id: callId, run_id: input.stepContext?.runId ?? null, step_run_id: input.stepContext?.stepRunId ?? null,
      attempt_id: input.stepContext?.attemptId ?? null, stage: input.promptManifest?.componentPromptId ?? input.stepContext?.stepName ?? null,
      provider, model, retry_index: input.callMetadata?.retryIndex ?? 0, call_reason: input.callMetadata?.callReason ?? null,
      input_tokens: null, output_tokens: null, reasoning_tokens: null, provider_request_id: null, error_code: null,
      expires_at: new Date(started + env.DIAGNOSTIC_RETENTION_MS).toISOString()}
    // Observability failure cannot cause a second model request or alter the business result.
    const append = async (event: ProviderCallEvent) => {try {await this.storage.append(event)} catch {console.error('[ProviderCalls] 调用事件暂未持久化')}}
    await append({...base,id: randomUUID(),event_kind: 'requested',occurred_at: new Date(started).toISOString(),latency_ms: null})
    return {
      complete: (result: ChatCompletionResult) => append({...base,id: randomUUID(),event_kind: 'completed',occurred_at: new Date().toISOString(),
        latency_ms: Date.now() - started,model: result.model,input_tokens: result.inputTokens ?? null,output_tokens: result.outputTokens ?? null,
        reasoning_tokens: result.reasoningTokens ?? null,provider_request_id: result.providerRequestId ?? null}),
      fail: (error: unknown) => append({...base,id: randomUUID(),event_kind: 'failed',occurred_at: new Date().toISOString(),latency_ms: Date.now() - started,
        error_code: error && typeof error === 'object' && 'status' in error ? `HTTP_${String(error.status)}` : error instanceof Error ? error.name : 'PROVIDER_CALL_FAILED'}),
    }
  }
}
export const providerCallRecorder = new ProviderCallRecorder()
export async function cleanupProviderCallEvents() {
  const now = new Date().toISOString()
  if (env.DATABASE_PROVIDER === 'supabase') await createSupabaseRestClient({useServiceRole: true}).request('/rest/v1/provider_calls', {
    method: 'DELETE',searchParams: {expires_at: `lte.${now}`},prefer: 'return=minimal'})
  else database().query('DELETE FROM provider_calls WHERE expires_at <= ?').run(now)
}

export async function summarizePhysicalProviderCalls(runIds?: string[]) {
  let rows:ProviderCallEvent[]
  if(env.DATABASE_PROVIDER==='supabase') rows=await createSupabaseRestClient({useServiceRole:true}).request<ProviderCallEvent[]>('/rest/v1/provider_calls',{
    searchParams:{select:'*',...(runIds?.length?{run_id:`in.(${runIds.join(',')})`}:{})}})
  else rows=database().query(`SELECT * FROM provider_calls ${runIds?.length?`WHERE run_id IN (${runIds.map(()=>'?').join(',')})`:''}`).all(...(runIds??[])) as ProviderCallEvent[]
  const calls=new Map<string,ProviderCallEvent[]>()
  for(const row of rows){const entries=calls.get(row.call_id)??[];entries.push(row);calls.set(row.call_id,entries)}
  let knownInput=0,knownOutput=0,missing=0,totalLatency=0,finished=0
  for(const events of calls.values()){
    const terminal=events.find(event=>event.event_kind==='completed'||event.event_kind==='failed')
    if(terminal?.input_tokens===null || terminal?.input_tokens===undefined || terminal.output_tokens===null || terminal.output_tokens===undefined)missing++
    knownInput+=terminal?.input_tokens??0;knownOutput+=terminal?.output_tokens??0
    if(terminal?.latency_ms!==null&&terminal?.latency_ms!==undefined){totalLatency+=terminal.latency_ms;finished++}
  }
  return {total_attempts:calls.size,avg_latency_ms:finished?totalLatency/finished:null,
    total_input_tokens:missing?null:knownInput,total_output_tokens:missing?null:knownOutput,
    known_input_tokens:knownInput,known_output_tokens:knownOutput,missing_usage_calls:missing,usage_complete:missing===0,
    source:'append_only_provider_calls' as const}
}
