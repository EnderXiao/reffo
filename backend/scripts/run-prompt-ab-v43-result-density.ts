import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import OpenAI from 'openai'
import {
  V42_RESULT_BASELINE_VERSION,
  V43_RESULT_PROMPT_VERSION,
  buildV42ResultBaselineMessages,
  buildV43BlindJudgeMessages,
  buildV43ResultGenerationMessages,
} from '@/prompts/v43-result-prompts'
import type { ChatMessage } from '@/providers/llm-provider'

type JsonObject = Record<string, unknown>

interface UsageRow {
  stage: string
  model: string
  inputTokens: number
  outputTokens: number
  latencyMs: number
}

interface CandidateMetrics {
  bulletCount: number
  taskOnlyBullets: number
  outcomeBullets: number
  taskOnlyRatio: number
  outcomeDensity: number
  unsupportedAttributionTerms: string[]
}

interface BlindEvaluation {
  model: string
  order: 'forward' | 'reverse'
  baselineScore: number | null
  optimizedScore: number | null
  winner: 'baseline' | 'optimized' | 'tie' | 'unknown'
  confidence: string
  baselineDimensions: Record<string, number | null>
  optimizedDimensions: Record<string, number | null>
  baselineTaskOnlyRatio: number | null
  optimizedTaskOnlyRatio: number | null
  baselineUnsupportedClaims: number
  optimizedUnsupportedClaims: number
  baselineAttributionErrors: number
  optimizedAttributionErrors: number
}

interface CaseResult {
  caseId: string
  resumeId: string
  jobId: string
  company: string
  position: string
  selectionMetrics: CandidateMetrics
  baselineResume: string
  optimizedResume: string
  baselineMetrics: CandidateMetrics
  optimizedMetrics: CandidateMetrics
  blindEvaluations: BlindEvaluation[]
  blindAverage: {
    baseline: number | null
    optimized: number | null
    absoluteGain: number | null
  }
}

const rootDirectory = resolve(process.cwd(), '..')
const checkpointPath = resolve(
  process.cwd(),
  process.argv[2] ?? '../.artifacts/prompt-ab-v4.3-result-density-2026-08-06.json'
)
const sourceCheckpointPath = resolve(
  process.cwd(),
  process.argv[3] ?? '../.artifacts/prompt-ab-v4.1-10x3-2026-07-27.json'
)
const privateRoot = resolve(process.cwd(), 'data/prompt-ab/private-results')
const reviewRoot = resolve(process.cwd(), 'data/prompt-ab/review-html')
const reportPath = resolve(process.cwd(), 'data/prompt-ab/v4.3-result-density-report.md')
const generationModel = process.env.PROMPT_AB_GENERATION_MODEL || 'deepseek-v4-pro'
const proJudgeModel = process.env.PROMPT_AB_PRO_JUDGE_MODEL || 'deepseek-v4-pro'
const flashJudgeModel = process.env.PROMPT_AB_FLASH_JUDGE_MODEL || 'deepseek-v4-flash'

const ACTION_PATTERN = /(?:负责|参与|协助|跟进|维护|整理|发布|运营|对接|支持|执行|进行|开展|处理|管理|制定|撰写|输出|组织|推进|监控|分析|调研|沟通|测试|设计|开发)/
const OUTCOME_PATTERN = /(?:%|％|\d\s*倍|万|亿|提升|降低|增长|减少|缩短|完成|上线|落地|交付|搭建|建立|实现|覆盖|达成|获得|获评|破\s*\d|从零到一|冷启动|沉淀|转化|留存|收入|营收|成本|利润|准确率|完成率|响应时间|周期)/i
const ATTRIBUTION_TERMS = ['主导', '独立', '精通', '熟练', '全流程', '驱动决策', '决策支持']
const DIMENSIONS = [
  'factual_fidelity',
  'result_density',
  'task_list_control',
  'outcome_relevance',
  'attribution_accuracy',
  'ats_readability',
]

function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function getNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

function getObject(value: unknown) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : {}
}

function average(values: Array<number | null>) {
  const valid = values.filter((value): value is number => value !== null)
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null
}

function round(value: number | null, digits = 2) {
  return value === null ? null : Number(value.toFixed(digits))
}

function analyzeResume(markdown: string, sourceResume: string): CandidateMetrics {
  const bullets = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
  const taskOnlyBullets = bullets.filter(
    (bullet) => ACTION_PATTERN.test(bullet) && !OUTCOME_PATTERN.test(bullet)
  ).length
  const outcomeBullets = bullets.filter((bullet) => OUTCOME_PATTERN.test(bullet)).length
  const unsupportedAttributionTerms = ATTRIBUTION_TERMS.filter(
    (term) => markdown.includes(term) && !sourceResume.includes(term)
  )

  return {
    bulletCount: bullets.length,
    taskOnlyBullets,
    outcomeBullets,
    taskOnlyRatio: bullets.length ? Number((taskOnlyBullets / bullets.length).toFixed(3)) : 0,
    outcomeDensity: bullets.length ? Number((outcomeBullets / bullets.length).toFixed(3)) : 0,
    unsupportedAttributionTerms,
  }
}

function stripMarkdownFence(content: string) {
  const trimmed = content.trim()
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i)
  return (fenced?.[1] ?? trimmed).trim()
}

function parseJson(content: string) {
  const stripped = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
  try {
    return JSON.parse(stripped) as JsonObject
  } catch {
    const start = stripped.indexOf('{')
    const end = stripped.lastIndexOf('}')
    if (start < 0 || end <= start) {
      throw new Error('模型未返回可解析 JSON')
    }
    return JSON.parse(stripped.slice(start, end + 1)) as JsonObject
  }
}

const apiKey = process.env.OPENAI_API_KEY?.trim()
if (!apiKey) {
  throw new Error('OPENAI_API_KEY 未配置')
}

const client = new OpenAI({
  apiKey,
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.deepseek.com',
})
const usageRows: UsageRow[] = []

async function complete(
  stage: string,
  model: string,
  messages: ChatMessage[],
  options: { json?: boolean; temperature?: number; maxTokens?: number } = {}
) {
  let lastError: unknown
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const startedAt = Date.now()
    try {
      const response = await client.chat.completions.create({
        model,
        messages,
        temperature: options.temperature ?? 0.1,
        max_tokens: options.maxTokens ?? 8000,
        response_format: options.json ? { type: 'json_object' } : undefined,
      })
      const content = response.choices[0]?.message?.content?.trim()
      const row = {
        stage,
        model,
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        latencyMs: Date.now() - startedAt,
      }
      usageRows.push(row)
      if (!content) {
        throw new Error('模型返回空内容')
      }
      console.log(JSON.stringify({ event: 'api_call_completed', ...row }))
      return content
    } catch (error) {
      lastError = error
      console.log(JSON.stringify({
        event: 'api_call_failed',
        stage,
        model,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      }))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${stage} 调用失败`)
}

async function completeJson(stage: string, model: string, messages: ChatMessage[]) {
  const first = await complete(stage, model, messages, {
    json: true,
    temperature: 0.05,
    maxTokens: 12000,
  })
  try {
    return parseJson(first)
  } catch (error) {
    return parseJson(await complete(
      `${stage}:json-repair`,
      model,
      [
        ...messages,
        { role: 'assistant', content: first },
        {
          role: 'user',
          content: `上次输出无法解析：${error instanceof Error ? error.message : String(error)}。请只返回符合既定结构的 JSON 对象。`,
        },
      ],
      { json: true, temperature: 0, maxTokens: 12000 }
    ))
  }
}

function normalizeBlindEvaluation(
  raw: JsonObject,
  model: string,
  order: 'forward' | 'reverse'
): BlindEvaluation {
  const evaluations = getArray(raw.evaluations).map(getObject)
  const x = evaluations.find((item) => item.candidate_id === 'X') ?? {}
  const y = evaluations.find((item) => item.candidate_id === 'Y') ?? {}
  const baseline = order === 'forward' ? x : y
  const optimized = order === 'forward' ? y : x
  const rawWinner = typeof raw.winner === 'string' ? raw.winner : ''
  const winner = rawWinner === 'tie'
    ? 'tie'
    : rawWinner === 'X'
      ? order === 'forward' ? 'baseline' : 'optimized'
      : rawWinner === 'Y'
        ? order === 'forward' ? 'optimized' : 'baseline'
        : 'unknown'
  const dimensions = (evaluation: JsonObject) => Object.fromEntries(
    DIMENSIONS.map((dimension) => [dimension, getNumber(evaluation[dimension])])
  )

  return {
    model,
    order,
    baselineScore: getNumber(baseline.total_score),
    optimizedScore: getNumber(optimized.total_score),
    winner,
    confidence: typeof raw.confidence === 'string' ? raw.confidence : 'unknown',
    baselineDimensions: dimensions(baseline),
    optimizedDimensions: dimensions(optimized),
    baselineTaskOnlyRatio: getNumber(baseline.task_only_bullet_ratio),
    optimizedTaskOnlyRatio: getNumber(optimized.task_only_bullet_ratio),
    baselineUnsupportedClaims: getArray(baseline.unsupported_claims).length,
    optimizedUnsupportedClaims: getArray(optimized.unsupported_claims).length,
    baselineAttributionErrors: getArray(baseline.attribution_errors).length,
    optimizedAttributionErrors: getArray(optimized.attribution_errors).length,
  }
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function aggregate(results: CaseResult[]) {
  const evaluations = results.flatMap((result) => result.blindEvaluations)
  const completedEvaluations = evaluations.filter(
    (item) => item.baselineScore !== null && item.optimizedScore !== null
  )
  const primaryEvaluations = completedEvaluations.filter((item) => item.model === proJudgeModel)
  const baselineAverage = average(primaryEvaluations.map((item) => item.baselineScore))
  const optimizedAverage = average(primaryEvaluations.map((item) => item.optimizedScore))
  const dimensionAverage = (side: 'baseline' | 'optimized', dimension: string) => average(
    primaryEvaluations.map((item) => getNumber(
      (side === 'baseline' ? item.baselineDimensions : item.optimizedDimensions)[dimension]
    ))
  )
  const wins = primaryEvaluations.reduce(
    (summary, item) => {
      summary[item.winner] += 1
      return summary
    },
    { baseline: 0, optimized: 0, tie: 0, unknown: 0 }
  )

  return {
    cases: results.length,
    blindEvaluations: evaluations.length,
    completedBlindEvaluations: completedEvaluations.length,
    primaryJudgeModel: proJudgeModel,
    primaryBlindEvaluations: primaryEvaluations.length,
    judgeCompletionByModel: Object.fromEntries(
      [...new Set(evaluations.map((item) => item.model))].map((model) => {
        const modelEvaluations = evaluations.filter((item) => item.model === model)
        const completed = modelEvaluations.filter(
          (item) => item.baselineScore !== null && item.optimizedScore !== null
        ).length
        return [model, {
          attempted: modelEvaluations.length,
          completed,
          completionRate: round(completed / modelEvaluations.length, 3),
        }]
      })
    ),
    baselineAverage: round(baselineAverage),
    optimizedAverage: round(optimizedAverage),
    absoluteGain: round(
      baselineAverage === null || optimizedAverage === null
        ? null
        : optimizedAverage - baselineAverage
    ),
    relativeGainPercent: round(
      baselineAverage && optimizedAverage !== null
        ? ((optimizedAverage - baselineAverage) / baselineAverage) * 100
        : null
    ),
    wins,
    localMetrics: {
      baselineTaskOnlyRatio: round(average(results.map((item) => item.baselineMetrics.taskOnlyRatio)), 3),
      optimizedTaskOnlyRatio: round(average(results.map((item) => item.optimizedMetrics.taskOnlyRatio)), 3),
      baselineOutcomeDensity: round(average(results.map((item) => item.baselineMetrics.outcomeDensity)), 3),
      optimizedOutcomeDensity: round(average(results.map((item) => item.optimizedMetrics.outcomeDensity)), 3),
      baselineUnsupportedAttributionTerms: results.reduce(
        (sum, item) => sum + item.baselineMetrics.unsupportedAttributionTerms.length,
        0
      ),
      optimizedUnsupportedAttributionTerms: results.reduce(
        (sum, item) => sum + item.optimizedMetrics.unsupportedAttributionTerms.length,
        0
      ),
    },
    judgeMetrics: Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, {
      baseline: round(dimensionAverage('baseline', dimension)),
      optimized: round(dimensionAverage('optimized', dimension)),
      gain: round((() => {
        const baseline = dimensionAverage('baseline', dimension)
        const optimized = dimensionAverage('optimized', dimension)
        return baseline === null || optimized === null ? null : optimized - baseline
      })()),
    }])),
    factualRisks: {
      baselineUnsupportedClaims: primaryEvaluations.reduce(
        (sum, item) => sum + item.baselineUnsupportedClaims,
        0
      ),
      optimizedUnsupportedClaims: primaryEvaluations.reduce(
        (sum, item) => sum + item.optimizedUnsupportedClaims,
        0
      ),
      baselineAttributionErrors: primaryEvaluations.reduce(
        (sum, item) => sum + item.baselineAttributionErrors,
        0
      ),
      optimizedAttributionErrors: primaryEvaluations.reduce(
        (sum, item) => sum + item.optimizedAttributionErrors,
        0
      ),
    },
  }
}

function summarizeUsage() {
  return {
    calls: usageRows.length,
    inputTokens: usageRows.reduce((sum, row) => sum + row.inputTokens, 0),
    outputTokens: usageRows.reduce((sum, row) => sum + row.outputTokens, 0),
    latencyMs: usageRows.reduce((sum, row) => sum + row.latencyMs, 0),
    byModel: Object.fromEntries([...new Set(usageRows.map((row) => row.model))].map((model) => {
      const rows = usageRows.filter((row) => row.model === model)
      return [model, {
        calls: rows.length,
        inputTokens: rows.reduce((sum, row) => sum + row.inputTokens, 0),
        outputTokens: rows.reduce((sum, row) => sum + row.outputTokens, 0),
      }]
    })),
  }
}

function renderReview(runId: string, results: CaseResult[], aggregateResult: ReturnType<typeof aggregate>) {
  const outputDirectory = join(reviewRoot, runId)
  mkdirSync(outputDirectory, { recursive: true })
  const style = `<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;background:#f4f4f1;color:#171717;margin:0}.page{max-width:1480px;margin:auto;padding:28px}a{color:#111}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.card,section{background:#fff;border:1px solid #d8d8d2;border-radius:10px;padding:18px;margin:14px 0}.resume{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}.metric strong{display:block;font-size:24px}table{width:100%;border-collapse:collapse;background:#fff}th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd}@media(max-width:900px){.grid{grid-template-columns:1fr}}
</style>`

  for (const result of results) {
    const rows = result.blindEvaluations.map((item) => `<tr><td>${escapeHtml(item.model)}</td><td>${item.order}</td><td>${item.baselineScore ?? '-'}</td><td>${item.optimizedScore ?? '-'}</td><td>${item.winner}</td></tr>`).join('')
    writeFileSync(join(outputDirectory, `${safeFilename(result.caseId)}.html`), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(result.caseId)}</title>${style}</head><body><main class="page"><p><a href="index.html">← 返回索引</a></p><h1>${escapeHtml(result.company)} · ${escapeHtml(result.position)}</h1><p>${escapeHtml(result.caseId)}</p><div class="metrics"><div class="card metric"><span>基线盲评</span><strong>${result.blindAverage.baseline ?? '-'}</strong></div><div class="card metric"><span>v4.3 盲评</span><strong>${result.blindAverage.optimized ?? '-'}</strong></div><div class="card metric"><span>提升</span><strong>${result.blindAverage.absoluteGain ?? '-'}</strong></div><div class="card metric"><span>动作占比</span><strong>${result.baselineMetrics.taskOnlyRatio} → ${result.optimizedMetrics.taskOnlyRatio}</strong></div><div class="card metric"><span>结果密度</span><strong>${result.baselineMetrics.outcomeDensity} → ${result.optimizedMetrics.outcomeDensity}</strong></div></div><section><h2>盲评明细</h2><table><thead><tr><th>模型</th><th>顺序</th><th>v4.2</th><th>v4.3</th><th>胜者</th></tr></thead><tbody>${rows}</tbody></table></section><div class="grid"><section><h2>v4.2.1 基线</h2><div class="resume">${escapeHtml(result.baselineResume)}</div></section><section><h2>v4.3 结果导向</h2><div class="resume">${escapeHtml(result.optimizedResume)}</div></section></div></main></body></html>`)
  }

  const indexRows = results.map((result) => `<tr><td><a href="${safeFilename(result.caseId)}.html">${escapeHtml(result.caseId)}</a></td><td>${escapeHtml(result.company)}</td><td>${escapeHtml(result.position)}</td><td>${result.blindAverage.baseline ?? '-'}</td><td>${result.blindAverage.optimized ?? '-'}</td><td>${result.blindAverage.absoluteGain ?? '-'}</td><td>${result.baselineMetrics.taskOnlyRatio} → ${result.optimizedMetrics.taskOnlyRatio}</td><td>${result.baselineMetrics.outcomeDensity} → ${result.optimizedMetrics.outcomeDensity}</td></tr>`).join('')
  writeFileSync(join(outputDirectory, 'index.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>v4.3 结果密度 A/B</title>${style}</head><body><main class="page"><h1>v4.3 结果密度定向 A/B</h1><div class="metrics"><div class="card metric"><span>案例</span><strong>${aggregateResult.cases}</strong></div><div class="card metric"><span>v4.2 均分</span><strong>${aggregateResult.baselineAverage ?? '-'}</strong></div><div class="card metric"><span>v4.3 均分</span><strong>${aggregateResult.optimizedAverage ?? '-'}</strong></div><div class="card metric"><span>提升</span><strong>${aggregateResult.absoluteGain ?? '-'}</strong></div></div><table><thead><tr><th>案例</th><th>公司</th><th>岗位</th><th>v4.2</th><th>v4.3</th><th>提升</th><th>动作占比</th><th>结果密度</th></tr></thead><tbody>${indexRows}</tbody></table></main></body></html>`)
  return join(outputDirectory, 'index.html')
}

function renderReport(
  runId: string,
  results: CaseResult[],
  aggregateResult: ReturnType<typeof aggregate>,
  usage: ReturnType<typeof summarizeUsage>,
  reviewIndex: string
) {
  const caseRows = results.map((item) => `| ${item.company} / ${item.position} | ${item.blindAverage.baseline ?? '-'} | ${item.blindAverage.optimized ?? '-'} | ${item.blindAverage.absoluteGain ?? '-'} | ${item.baselineMetrics.taskOnlyRatio} → ${item.optimizedMetrics.taskOnlyRatio} | ${item.baselineMetrics.outcomeDensity} → ${item.optimizedMetrics.outcomeDensity} |`).join('\n')
  const dimensionRows = DIMENSIONS.map((dimension) => {
    const metric = getObject(aggregateResult.judgeMetrics[dimension])
    return `| ${dimension} | ${metric.baseline ?? '-'} | ${metric.optimized ?? '-'} | ${metric.gain ?? '-'} |`
  }).join('\n')
  const taskReduction = aggregateResult.localMetrics.baselineTaskOnlyRatio !== null && aggregateResult.localMetrics.optimizedTaskOnlyRatio !== null
    ? round((aggregateResult.localMetrics.baselineTaskOnlyRatio - aggregateResult.localMetrics.optimizedTaskOnlyRatio) * 100, 1)
    : null
  const outcomeGain = aggregateResult.localMetrics.baselineOutcomeDensity !== null && aggregateResult.localMetrics.optimizedOutcomeDensity !== null
    ? round((aggregateResult.localMetrics.optimizedOutcomeDensity - aggregateResult.localMetrics.baselineOutcomeDensity) * 100, 1)
    : null

  return `# Reffo v4.3 结果密度定向 A/B 报告

运行：${runId}  
基线：${V42_RESULT_BASELINE_VERSION}  
优化版：${V43_RESULT_PROMPT_VERSION}  
测试范围：只选择 v4.1 不可交付案例中动作型 bullet 占比最高的 3 个案例。

## 结论

- 晋级结论：${aggregateResult.absoluteGain !== null && aggregateResult.absoluteGain > 0 ? '候选版可继续观察' : '候选版不晋级，保留 v4.2.1'}
- 主评审口径：${aggregateResult.primaryJudgeModel} 正反序盲评，有效 ${aggregateResult.primaryBlindEvaluations}/${results.length * 2} 次
- v4.2.1 主评审均分：${aggregateResult.baselineAverage ?? '-'}
- v4.3 主评审均分：${aggregateResult.optimizedAverage ?? '-'}
- 绝对提升：${aggregateResult.absoluteGain ?? '-'}
- 相对提升：${aggregateResult.relativeGainPercent ?? '-'}%
- 胜负：v4.3 ${aggregateResult.wins.optimized} 胜，v4.2 ${aggregateResult.wins.baseline} 胜，平局 ${aggregateResult.wins.tie}，未知 ${aggregateResult.wins.unknown}
- 本地动作型 bullet 占比：${aggregateResult.localMetrics.baselineTaskOnlyRatio ?? '-'} → ${aggregateResult.localMetrics.optimizedTaskOnlyRatio ?? '-'}，下降 ${taskReduction ?? '-'} 个百分点
- 本地结果/交付物密度：${aggregateResult.localMetrics.baselineOutcomeDensity ?? '-'} → ${aggregateResult.localMetrics.optimizedOutcomeDensity ?? '-'}，提升 ${outcomeGain ?? '-'} 个百分点

## 案例结果

| 案例 | v4.2 | v4.3 | 提升 | 动作占比 | 结果密度 |
| --- | ---: | ---: | ---: | ---: | ---: |
${caseRows}

## 盲评分维度

| 维度 | v4.2 | v4.3 | 提升 |
| --- | ---: | ---: | ---: |
${dimensionRows}

## 事实与归因风险

- Judge 标记的不受支持陈述：${aggregateResult.factualRisks.baselineUnsupportedClaims} → ${aggregateResult.factualRisks.optimizedUnsupportedClaims}
- Judge 标记的归因错误：${aggregateResult.factualRisks.baselineAttributionErrors} → ${aggregateResult.factualRisks.optimizedAttributionErrors}
- 本地高风险归因词：${aggregateResult.localMetrics.baselineUnsupportedAttributionTerms} → ${aggregateResult.localMetrics.optimizedUnsupportedAttributionTerms}

## Token 使用

- API 调用：${usage.calls}
- 输入 Token：${usage.inputTokens}
- 输出 Token：${usage.outputTokens}
- 未重新执行全量 30 案例，也未重新执行联网研究、简历分析、JD 解析或匹配分析。

## 评审器稳定性

${Object.entries(aggregateResult.judgeCompletionByModel).map(([model, value]) => {
    const metric = value as { attempted: number; completed: number; completionRate: number | null }
    return `- ${model}：完成 ${metric.completed}/${metric.attempted}，完成率 ${metric.completionRate === null ? '-' : round(metric.completionRate * 100, 1)}%`
  }).join('\n')}

## 材料

- 人工可读 HTML：${reviewIndex}
- 原始 checkpoint：${checkpointPath}

## 解释边界

本测试隔离评价“简历生成提示词”的结果导向能力，复用历史结构化简历、JD 和匹配分析。样本是刻意选择的高动作清单失败案例，不能外推为全部岗位总体提升。启发式动作比例只用于筛样和辅助观察；主质量结论以完成率 100% 的 Pro 正反序盲评、事实忠实和归因准确为准，Flash 仅用于记录评审器稳定性，不混入主分数。
`
}

const sourceCheckpoint = JSON.parse(readFileSync(sourceCheckpointPath, 'utf8')) as {
  metadata: { runId: string }
  results: Array<{
    caseId: string
    resumeId: string
    jobId: string
    company: string
    position: string
    optimized: { deliverable: boolean }
  }>
}
const sourcePrivateDirectory = join(privateRoot, sourceCheckpoint.metadata.runId)
const failedCandidates = sourceCheckpoint.results
  .filter((item) => !item.optimized.deliverable)
  .map((item) => {
    const packet = JSON.parse(readFileSync(
      join(sourcePrivateDirectory, `${safeFilename(item.caseId)}.json`),
      'utf8'
    )) as { sourceResume: string; optimized: { finalResume: string } }
    return {
      ...item,
      selectionMetrics: analyzeResume(packet.optimized.finalResume, packet.sourceResume),
    }
  })
  .filter((item) => item.selectionMetrics.bulletCount >= 4)
  .sort((left, right) =>
    right.selectionMetrics.taskOnlyRatio - left.selectionMetrics.taskOnlyRatio ||
    right.selectionMetrics.taskOnlyBullets - left.selectionMetrics.taskOnlyBullets
  )
const selected = failedCandidates.slice(0, 3)
if (selected.length !== 3) {
  throw new Error(`动作型失败案例不足 3 个，实际 ${selected.length} 个`)
}

const selectionFingerprint = createHash('sha256')
  .update(JSON.stringify({
    sourceRunId: sourceCheckpoint.metadata.runId,
    baseline: V42_RESULT_BASELINE_VERSION,
    optimized: V43_RESULT_PROMPT_VERSION,
    caseIds: selected.map((item) => item.caseId),
  }))
  .digest('hex')

let runId = `v4.3-result-density-${new Date().toISOString().replace(/[:.]/g, '-')}`
let results: CaseResult[] = []
if (existsSync(checkpointPath)) {
  const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8')) as {
    metadata: { runId: string; selectionFingerprint: string }
    results: CaseResult[]
  }
  if (checkpoint.metadata.selectionFingerprint !== selectionFingerprint) {
    throw new Error('v4.3 checkpoint 样本或提示词指纹不匹配')
  }
  runId = checkpoint.metadata.runId
  results = checkpoint.results
}
const privateDirectory = join(privateRoot, runId)
mkdirSync(privateDirectory, { recursive: true })

function writeCheckpoint(status: 'in_progress' | 'completed') {
  const aggregateResult = aggregate(results)
  mkdirSync(dirname(checkpointPath), { recursive: true })
  writeFileSync(checkpointPath, JSON.stringify({
    metadata: {
      runId,
      status,
      sourceRunId: sourceCheckpoint.metadata.runId,
      selectionFingerprint,
      selectionRule: 'v4.1 deliverable=false 中 task-only bullet ratio 最高的 3 个案例',
      selectedCaseIds: selected.map((item) => item.caseId),
      baselinePromptVersion: V42_RESULT_BASELINE_VERSION,
      optimizedPromptVersion: V43_RESULT_PROMPT_VERSION,
      generationModel,
      judgeModels: [proJudgeModel, flashJudgeModel],
      completedCases: results.length,
      totalCases: selected.length,
      privacy: 'Checkpoint 不保存原始简历、JD 或完整生成简历；完整材料仅在 private-results。',
    },
    aggregate: aggregateResult,
    usage: summarizeUsage(),
    results: results.map((item) => ({
      ...item,
      baselineResume: undefined,
      optimizedResume: undefined,
    })),
  }, null, 2))
}

for (const selectedCase of selected) {
  if (results.some((item) => item.caseId === selectedCase.caseId)) {
    continue
  }
  console.log(JSON.stringify({
    event: 'case_started',
    caseId: selectedCase.caseId,
    selectionMetrics: selectedCase.selectionMetrics,
  }))
  const sourcePacketPath = join(sourcePrivateDirectory, `${safeFilename(selectedCase.caseId)}.json`)
  const packet = JSON.parse(readFileSync(sourcePacketPath, 'utf8')) as {
    sourceResume: string
    jobDescription: string
    current: {
      suite: {
        resume_analysis: { structured_resume: unknown }
        job_profile: unknown
        match_analysis: unknown
      }
    }
  }
  const input = {
    sourceResume: packet.current.suite.resume_analysis.structured_resume,
    jobDescription: packet.current.suite.job_profile,
    matchAnalysis: packet.current.suite.match_analysis,
  }
  const [baselineRaw, optimizedRaw] = await Promise.all([
    complete(
      `${selectedCase.caseId}:generate-v42`,
      generationModel,
      buildV42ResultBaselineMessages(input),
      { temperature: 0.2, maxTokens: 9000 }
    ),
    complete(
      `${selectedCase.caseId}:generate-v43`,
      generationModel,
      buildV43ResultGenerationMessages(input),
      { temperature: 0.2, maxTokens: 9000 }
    ),
  ])
  const baselineResume = stripMarkdownFence(baselineRaw)
  const optimizedResume = stripMarkdownFence(optimizedRaw)
  const configurations = [
    { model: proJudgeModel, order: 'forward' as const },
    { model: proJudgeModel, order: 'reverse' as const },
    { model: flashJudgeModel, order: 'forward' as const },
    { model: flashJudgeModel, order: 'reverse' as const },
  ]
  const blindEvaluations = await Promise.all(configurations.map(async ({ model, order }) => {
    try {
      const raw = await completeJson(
        `${selectedCase.caseId}:judge-${model}-${order}`,
        model,
        buildV43BlindJudgeMessages({
          sourceResume: packet.sourceResume,
          jobDescription: packet.jobDescription,
          candidateX: order === 'forward' ? baselineResume : optimizedResume,
          candidateY: order === 'forward' ? optimizedResume : baselineResume,
        })
      )
      return normalizeBlindEvaluation(raw, model, order)
    } catch (error) {
      console.log(JSON.stringify({
        event: 'blind_evaluation_unavailable',
        caseId: selectedCase.caseId,
        model,
        order,
        error: error instanceof Error ? error.message : String(error),
      }))
      return {
        model,
        order,
        baselineScore: null,
        optimizedScore: null,
        winner: 'unknown' as const,
        confidence: 'unavailable',
        baselineDimensions: Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, null])),
        optimizedDimensions: Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, null])),
        baselineTaskOnlyRatio: null,
        optimizedTaskOnlyRatio: null,
        baselineUnsupportedClaims: 0,
        optimizedUnsupportedClaims: 0,
        baselineAttributionErrors: 0,
        optimizedAttributionErrors: 0,
      }
    }
  }))
  const baselineAverage = average(blindEvaluations.map((item) => item.baselineScore))
  const optimizedAverage = average(blindEvaluations.map((item) => item.optimizedScore))
  const result: CaseResult = {
    caseId: selectedCase.caseId,
    resumeId: selectedCase.resumeId,
    jobId: selectedCase.jobId,
    company: selectedCase.company,
    position: selectedCase.position,
    selectionMetrics: selectedCase.selectionMetrics,
    baselineResume,
    optimizedResume,
    baselineMetrics: analyzeResume(baselineResume, packet.sourceResume),
    optimizedMetrics: analyzeResume(optimizedResume, packet.sourceResume),
    blindEvaluations,
    blindAverage: {
      baseline: round(baselineAverage),
      optimized: round(optimizedAverage),
      absoluteGain: round(
        baselineAverage === null || optimizedAverage === null
          ? null
          : optimizedAverage - baselineAverage
      ),
    },
  }
  results.push(result)
  writeFileSync(join(privateDirectory, `${safeFilename(result.caseId)}.json`), JSON.stringify({
    privacy: 'PRIVATE_REVIEW_MATERIAL_DO_NOT_COMMIT',
    ...result,
    sourceResume: packet.sourceResume,
    jobDescription: packet.jobDescription,
  }, null, 2))
  writeCheckpoint('in_progress')
  console.log(JSON.stringify({
    event: 'case_completed',
    caseId: result.caseId,
    blindAverage: result.blindAverage,
    baselineMetrics: result.baselineMetrics,
    optimizedMetrics: result.optimizedMetrics,
  }))
}

writeCheckpoint('completed')
const aggregateResult = aggregate(results)
const usage = summarizeUsage()
const reviewIndex = renderReview(runId, results, aggregateResult)
writeFileSync(reportPath, renderReport(runId, results, aggregateResult, usage, reviewIndex))
console.log(JSON.stringify({
  event: 'v43_result_density_completed',
  runId,
  checkpointPath,
  reportPath,
  reviewIndex,
  aggregate: aggregateResult,
  usage,
}, null, 2))
