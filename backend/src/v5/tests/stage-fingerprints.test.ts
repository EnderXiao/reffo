import {expect,test} from 'bun:test'
import {resumeStageFingerprint,resumeStageCacheKey} from '@/v5/stage-fingerprints'
import {V5_PROMPT_VERSIONS} from '@/v5/prompts'

test('P10 changes only interview artifacts; owner and dependencies isolate reuse',()=>{
  const changed={...V5_PROMPT_VERSIONS,P10:'5.9.0-p10-test'}
  for(const stage of ['extraction','matching','generation'] as const) expect(resumeStageFingerprint(stage,changed)).toBe(resumeStageFingerprint(stage))
  expect(resumeStageFingerprint('interview',changed)).not.toBe(resumeStageFingerprint('interview'))
  expect(resumeStageCacheKey('matching','owner-a',{resume:'r',jd:'j'})).not.toBe(resumeStageCacheKey('matching','owner-b',{resume:'r',jd:'j'}))
  expect(resumeStageCacheKey('matching','owner-a',{resume:'r',jd:'j'})).not.toBe(resumeStageCacheKey('matching','owner-a',{resume:'r',jd:'j2'}))
})
