import {expect,test} from 'bun:test'
import {ProviderCallRecorder,type ProviderCallEvent} from './provider-call-recorder'

test('physical calls append requested and terminal rows without inventing missing usage',async()=>{
  const events:ProviderCallEvent[]=[]
  const recorder=new ProviderCallRecorder({append:async event=>{events.push(structuredClone(event))}})
  const one=await recorder.begin({messages:[],callMetadata:{callReason:'business_stage',contextMode:'full',repairScope:[],retryIndex:0,budgetRemaining:null}},'deepseek','test-model')
  await one.fail(Object.assign(new Error('must not persist private provider payload'),{status:503}))
  const retry=await recorder.begin({messages:[],callMetadata:{callReason:'network_retry',contextMode:'full',repairScope:[],retryIndex:1,budgetRemaining:null}},'deepseek','test-model')
  await retry.complete({provider:'deepseek',model:'test-model',content:'private response',latencyMs:5})
  expect(events.map(event=>event.event_kind)).toEqual(['requested','failed','requested','completed'])
  expect(new Set(events.map(event=>event.call_id)).size).toBe(2)
  expect(events[3]).toMatchObject({input_tokens:null,output_tokens:null,retry_index:1})
  expect(JSON.stringify(events)).not.toContain('private')
})
