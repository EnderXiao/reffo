import { expect, test } from 'bun:test'
import { assertV5ProductionWorkflow, assertV5ReleaseConfiguration, parseV5ReleaseProfile, v5ReleaseWorkflowOptions } from './v5-release'

test('release selection is explicit, atomic and reversible', () => {
  expect(parseV5ReleaseProfile(undefined)).toBe('legacy-dsl')
  expect(parseV5ReleaseProfile(' entry-r5 ')).toBe('entry-r5')
  expect(() => parseV5ReleaseProfile('entry-r4')).toThrow()
  expect(v5ReleaseWorkflowOptions('legacy-dsl')).toEqual({artifactGenerationMode:'dsl_v1'})
  expect(v5ReleaseWorkflowOptions('entry-r5')).toEqual({artifactGenerationMode:'writer_v1',
    jobTargetingPolicy:'job-targeted-v1',entryWritingPolicy:'entry-writing-v1'})
})

test('production accepts only the explicitly released complete Writer combination', () => {
  const config = {APP_ENV:'prod',V5_RELEASE_PROFILE:'entry-r5' as const}
  expect(() => assertV5ProductionWorkflow(config,v5ReleaseWorkflowOptions('entry-r5'))).not.toThrow()
  expect(() => assertV5ProductionWorkflow({...config,V5_RELEASE_PROFILE:'legacy-dsl'},v5ReleaseWorkflowOptions('entry-r5'))).toThrow()
  expect(() => assertV5ProductionWorkflow(config,{artifactGenerationMode:'writer_v1',jobTargetingPolicy:'job-targeted-v1'})).toThrow()
  expect(() => assertV5ProductionWorkflow(config,{artifactGenerationMode:'dsl_v1',jobTargetingPolicy:'job-targeted-v1'})).toThrow()
  expect(() => assertV5ProductionWorkflow({...config,V5_RELEASE_PROFILE:'legacy-dsl'},v5ReleaseWorkflowOptions('legacy-dsl'))).not.toThrow()
})

test('release profile rejects silent model or thinking-mode drift, without changing legacy configuration', () => {
  const config = {V5_RELEASE_PROFILE:'entry-r5' as const,AI_MODEL:'deepseek-v4-flash',OPENAI_BASE_URL:'https://api.deepseek.com',
    DEEPSEEK_THINKING_MODE:'disabled',DEEPSEEK_P01_THINKING_MODE:'disabled'}
  expect(() => assertV5ReleaseConfiguration(config)).not.toThrow()
  expect(() => assertV5ReleaseConfiguration({...config,DEEPSEEK_THINKING_MODE:'enabled',DEEPSEEK_P01_THINKING_MODE:'enabled'})).not.toThrow()
  for (const override of [{AI_MODEL:'deepseek-chat'},{OPENAI_BASE_URL:'https://example.invalid'},
    {DEEPSEEK_THINKING_MODE:'default'},{DEEPSEEK_P01_THINKING_MODE:'inherit'}]) {
    expect(() => assertV5ReleaseConfiguration({...config,...override})).toThrow()
    expect(() => assertV5ReleaseConfiguration({...config,...override,V5_RELEASE_PROFILE:'legacy-dsl'})).not.toThrow()
  }
})
