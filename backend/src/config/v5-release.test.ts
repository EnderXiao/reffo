import { expect, test } from 'bun:test'
import { assertV5ProductionWorkflow, assertV5ReleaseConfiguration, v5ReleaseWorkflowOptions } from './v5-release'

test('R5 is the fixed release workflow', () => {
  expect(v5ReleaseWorkflowOptions()).toEqual({artifactGenerationMode:'writer_v1',
    jobTargetingPolicy:'job-targeted-v1',entryWritingPolicy:'entry-writing-v1'})
})

test('production accepts only the explicitly released complete Writer combination', () => {
  const config = {APP_ENV:'prod'}
  expect(() => assertV5ProductionWorkflow(config,v5ReleaseWorkflowOptions())).not.toThrow()
  expect(() => assertV5ProductionWorkflow(config,{artifactGenerationMode:'writer_v1',jobTargetingPolicy:'job-targeted-v1'})).toThrow()
  expect(() => assertV5ProductionWorkflow(config,{artifactGenerationMode:'dsl_v1',jobTargetingPolicy:'job-targeted-v1'})).toThrow()
})

test('R5 rejects model or thinking-mode drift', () => {
  const config = {AI_MODEL:'deepseek-v4-flash',OPENAI_BASE_URL:'https://api.deepseek.com',
    DEEPSEEK_THINKING_MODE:'disabled',DEEPSEEK_P01_THINKING_MODE:'disabled'}
  expect(() => assertV5ReleaseConfiguration(config)).not.toThrow()
  expect(() => assertV5ReleaseConfiguration({...config,DEEPSEEK_THINKING_MODE:'enabled',DEEPSEEK_P01_THINKING_MODE:'enabled'})).not.toThrow()
  for (const override of [{AI_MODEL:'deepseek-chat'},{OPENAI_BASE_URL:'https://example.invalid'},
    {DEEPSEEK_THINKING_MODE:'default'},{DEEPSEEK_P01_THINKING_MODE:'inherit'}]) {
    expect(() => assertV5ReleaseConfiguration({...config,...override})).toThrow()
  }
})
