import {expect,test} from 'bun:test'
import {createRunContext} from './run-context'
import {runStep} from './run-step'
import {V5StageRuntime} from '@/v5/stage-runtime'

test('an upstream lease cancellation reaches an in-flight provider step and prevents later plugins',async()=>{
  const controller=new AbortController(),reason=new Error('lease ownership lost')
  const runtime=new V5StageRuntime({signal:controller.signal})
  let cancelled=false,providerStarted:()=>void=()=>{},laterCalls=0
  const started=new Promise<void>(resolve=>{providerStarted=resolve})
  const active=runtime.execute({plugin:{id:'match',version:'test',stage:'match',run:()=>runStep({
    runContext:runtime.runContext,stepName:'provider',execute:async({signal})=>{
      providerStarted()
      return new Promise<never>((_,reject)=>signal!.addEventListener('abort',()=>{cancelled=true;reject(signal!.reason)},{once:true}))
    },
  })},input:{}})
  await started;controller.abort(reason)
  await expect(active).rejects.toBeDefined()
  expect(cancelled).toBe(true)
  await expect(runtime.execute({plugin:{id:'write',version:'test',stage:'generate',run:()=>{laterCalls++;return 'never'}},input:{}})).rejects.toBe(reason)
  expect(laterCalls).toBe(0)
})

test('an already aborted run never starts a provider operation',async()=>{
  const controller=new AbortController(),reason=new Error('cancelled before work')
  controller.abort(reason)
  let calls=0
  await expect(runStep({runContext:{...createRunContext(),signal:controller.signal},stepName:'not-started',execute:async()=>{calls++;return true}})).rejects.toMatchObject({cause:reason})
  expect(calls).toBe(0)
})
