// Offline regression helper: replays owner-readable nonprod responses only.
// It never calls a live provider or writes a trusted extraction cache.
import { resolve } from 'node:path'
import { readdir } from 'node:fs/promises'
import { V5ResumeOptimizationWorkflow } from '@/v5/main/workflow'
import type { ChatMessage, LlmProvider } from '@/providers/llm-provider'
import { atomicWriteJson } from '@/v5/evaluation-runner-support'

function payload(messages: ChatMessage[]) {
  return JSON.parse(messages[1].content.split('UNTRUSTED_INPUT_JSON:\n')[1].split('\n\n只返回')[0]).payload
}

const root = resolve(process.argv[2] ?? '')
const output = resolve(process.argv[3] ?? '')
if (!process.argv[2] || !process.argv[3] || output === root || output.startsWith(`${root}/`)) {
  throw new Error('Usage: replay-v5-recorded-run.ts <source-run> <separate-output.json>')
}
const manifest = (await Bun.file(resolve(root, 'run-manifest.json')).json()).payload
if (manifest.selectedCases.length !== 1) throw new Error('Offline replay requires one case')
const histories = await Bun.file(manifest.historyPath).json()
const history = histories[manifest.selectedCases[0] - 1]
const directory = resolve(root, 'private-calls')
const records = await Promise.all((await readdir(directory)).filter(f => f.endsWith('.json')).sort()
  .map(f => Bun.file(resolve(directory, f)).json()))
const calls: string[] = []
const provider: LlmProvider = {
  complete: async request => {
    const requested = payload(request.messages)
    const document = requested.canonicalSourceDocument ?? requested.originalEnvelope?.payload.canonicalSourceDocument
    const record = records.find(item => {
      if (item.promptVersion !== request.promptVersion) return false
      if (!document) return true
      const saved = payload(item.messages)
      const source = saved.canonicalSourceDocument ?? saved.originalEnvelope?.payload.canonicalSourceDocument
      return source?.sha256 === document.sha256 && JSON.stringify(source.blocks) === JSON.stringify(document.blocks)
    })
    if (!record) throw new Error(`No recorded response for ${request.promptVersion}`)
    calls.push(request.promptVersion ?? 'unknown')
    return { provider: 'offline-replay', model: 'recorded', ...record.response, latencyMs: 0 }
  },
}
const workflow = new V5ResumeOptimizationWorkflow({
  provider, enableDefaultSubscribers: false, artifactGenerationMode: 'dsl_v1', interviewMode: 'deferred',
})
try {
  const result = await workflow.run({ resumeMarkdown: history.resume_content, jobDescription: history.jd_content })
  await atomicWriteJson(output, { externalCallsMade: 0, sourceRun: root, calls, result })
  console.log(JSON.stringify({ externalCallsMade: 0, state: result.state, output }))
} catch (error) {
  const failure = error as Error & { code?: string; issues?: unknown[] }
  await atomicWriteJson(output, { externalCallsMade: 0, sourceRun: root, calls, error: {
    code: failure.code, message: failure.message, issues: failure.issues,
  } })
  console.log(JSON.stringify({ externalCallsMade: 0, errorCode: failure.code, output }))
  process.exitCode = 1
}
