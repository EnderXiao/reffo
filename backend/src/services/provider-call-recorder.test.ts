import {expect,test} from 'bun:test'
import {Database} from 'bun:sqlite'
import {ProviderCallRecorder, classifyProviderFailure, ensureProviderCallColumns, type ProviderCallEvent} from './provider-call-recorder'

const beginInput = (retryIndex = 0) => ({messages: [], callMetadata: {callReason: 'business_stage' as const, contextMode: 'full' as const, repairScope: [], retryIndex, budgetRemaining: null}})
const namedError = (name: string, message: string) => Object.assign(new Error(message), {name})

test('physical calls append requested and terminal rows without inventing missing usage',async()=>{
  const events:ProviderCallEvent[]=[]
  const recorder=new ProviderCallRecorder({append:async event=>{events.push(structuredClone(event))}})
  const one=await recorder.begin(beginInput(),'deepseek','test-model')
  await one.fail(Object.assign(new Error('must not persist private provider payload'),{status:503}))
  const retry=await recorder.begin(beginInput(1),'deepseek','test-model')
  await retry.complete({provider:'deepseek',model:'test-model',content:'private response',latencyMs:5})
  expect(events.map(event=>event.event_kind)).toEqual(['requested','failed','requested','completed'])
  expect(new Set(events.map(event=>event.call_id)).size).toBe(2)
  expect(events[3]).toMatchObject({input_tokens:null,output_tokens:null,retry_index:1})
  expect(events[0]).toMatchObject({failure_class:null,provider_status:null})
  expect(events[1]).toMatchObject({error_code:'HTTP_503',failure_class:'provider_http',provider_status:503})
  expect(events[2]).toMatchObject({failure_class:null,provider_status:null})
  expect(events[3]).toMatchObject({failure_class:null,provider_status:null})
  expect(JSON.stringify(events)).not.toContain('private')
})

test('failed calls classify failures without persisting any message text',async()=>{
  const events:ProviderCallEvent[]=[]
  const recorder=new ProviderCallRecorder({append:async event=>{events.push(structuredClone(event))}})
  const cases:Array<[unknown,string,number|null]>=[
    [namedError('APIConnectionTimeoutError','connect ETIMEDOUT'),'timeout',null],
    [namedError('APIConnectionError','fetch failed'),'network',null],
    [namedError('RateLimitError','too many requests'),'rate_limit',null],
    [namedError('AuthenticationError','bad api key'),'auth',null],
    [namedError('BadRequestError','invalid request'),'bad_request',null],
    [new Error('PROVIDER_STREAM_INCOMPLETE'),'stream_incomplete',null],
    [new Error('PROVIDER_STREAM_SIZE_EXCEEDED'),'stream_size_exceeded',null],
    [namedError('AbortError','aborted'),'aborted',null],
    [Object.assign(new Error('boom'),{status:429}),'provider_http',429],
    [new Error('generic failure detail'),'Error',null],
    ['not an error','sdk_error',null],
  ]
  for(const [error] of cases){
    const call=await recorder.begin(beginInput(),'deepseek','test-model')
    await call.fail(error)
  }
  const failed=events.filter(event=>event.event_kind==='failed')
  expect(failed.map(event=>event.failure_class)).toEqual(cases.map(([,failureClass])=>failureClass))
  expect(failed.map(event=>event.provider_status)).toEqual(cases.map(([,,providerStatus])=>providerStatus))
  expect(failed.map(event=>event.error_code)).toEqual(['APIConnectionTimeoutError','APIConnectionError','RateLimitError','AuthenticationError','BadRequestError','Error','Error','AbortError','HTTP_429','Error','PROVIDER_CALL_FAILED'])
  const serialized=JSON.stringify(events)
  // 注意 'aborted' 是合法的分类名，不在禁止文本里；禁止的是原始 message 文本。
  for(const text of ['ETIMEDOUT','fetch failed','too many requests','bad api key','invalid request','boom','generic failure detail']){
    expect(serialized).not.toContain(text)
  }
})

test('classifyProviderFailure maps rate limit before the generic status rule',()=>{
  expect(classifyProviderFailure(Object.assign(new Error('429'),{name:'RateLimitError',status:429}))).toEqual({failureClass:'rate_limit',providerStatus:null})
  expect(classifyProviderFailure(Object.assign(new Error('x'),{status:502}))).toEqual({failureClass:'provider_http',providerStatus:502})
  expect(classifyProviderFailure(Object.assign(new Error('x'),{status:'nope'}))).toEqual({failureClass:'Error',providerStatus:null})
})

test('ensureProviderCallColumns upgrades legacy sqlite tables and is idempotent',()=>{
  const db=new Database(':memory:')
  db.exec('CREATE TABLE provider_calls (id TEXT PRIMARY KEY,call_id TEXT NOT NULL,event_kind TEXT NOT NULL,run_id TEXT,provider TEXT NOT NULL,model TEXT NOT NULL,retry_index INTEGER NOT NULL,occurred_at TEXT NOT NULL,expires_at TEXT NOT NULL,UNIQUE(call_id,event_kind));')
  ensureProviderCallColumns(db)
  ensureProviderCallColumns(db)
  const columns=(db.query('PRAGMA table_info(provider_calls)').all() as Array<{name:string}>).map(column=>column.name)
  expect(columns).toContain('failure_class')
  expect(columns).toContain('provider_status')
  db.close()
})
