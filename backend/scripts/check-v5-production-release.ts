// Read-only post-deploy check. No generation, quota usage, or database writes.
import { z } from 'zod'

const base = process.argv[2]
const profile = process.argv[3] ?? 'entry-r5'
if (!base || !['entry-r5', 'legacy-dsl'].includes(profile)) {
  throw new Error('用法：bun scripts/check-v5-production-release.ts <生产 HTTPS origin> [entry-r5|legacy-dsl]')
}
const origin = new URL(base)
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
  throw new Error('必须提供无账号、参数或路径的生产 HTTPS origin')
}
const response = await fetch(new URL('/api/v1/mvp/health', origin), { signal: AbortSignal.timeout(15000), redirect: 'error' })
if (!response.ok) throw new Error(`生产健康检查 HTTP ${response.status}`)
const health = z.object({ status: z.literal('ok'), generation: z.object({
  environment: z.literal('prod'), profile: z.enum(['entry-r5','legacy-dsl']), artifactGenerationMode:z.string(),
  writerPromptVersion:z.string().nullable(), layoutVersion:z.string().nullable(), model:z.string(),
  thinkingMode:z.string(), extractionThinkingMode:z.string(),
}) }).parse(await response.json())
const release = health.generation
if (release.profile !== profile) throw new Error('生产服务版本与期望发布配置不一致')
if (profile === 'entry-r5' && (release.artifactGenerationMode !== 'writer_v1'
  || release.writerPromptVersion !== '5.2.0-p06c-entry-writer-r5' || release.layoutVersion !== 'entry-layout-v2'
  || release.model !== 'deepseek-v4-flash' || release.thinkingMode !== 'disabled' || release.extractionThinkingMode !== 'disabled')) {
  throw new Error('生产模型、提示词或编排配置不符合本次发布版本')
}
if (profile === 'legacy-dsl' && release.artifactGenerationMode !== 'dsl_v1') throw new Error('回滚未恢复 DSL 路径')
console.log(JSON.stringify({passed:true,readOnly:true,generationCalls:0,...release},null,2))
