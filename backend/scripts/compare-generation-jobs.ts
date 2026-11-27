import {createHash, randomInt, randomUUID} from 'node:crypto'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {parseArgs} from 'node:util'
import {z} from 'zod'

const evaluationFixtures = z.array(z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  resume_markdown: z.string().trim().min(10).max(200_000),
  jd_text: z.string().trim().min(10).max(100_000),
})).min(1).max(30)

type Fixture = z.infer<typeof evaluationFixtures>[number]
type Client = {
  baseUrl: URL
  timeoutMs: number
  pollMs: number
  fetch: (url: URL, options?: RequestInit) => Promise<Response>
}

const envelope = z.object({success: z.boolean(), data: z.unknown().optional()})
const jobSummary = z.object({
  id: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  history_id: z.string().nullish(),
  failure: z.object({code: z.string().regex(/^[A-Z0-9_]{1,80}$/)}).nullish(),
})
const historyInfo = z.object({
  optimized_content: z.string(),
  process_result: z.object({
    interview: z.unknown().optional(),
    optimized: z.object({optimized_resume: z.string()}).passthrough(),
  }).passthrough(),
  progress: z.object({interview: z.string().optional()}).nullish(),
  interview_task: z.object({status: z.string()}).nullish(),
})

type ResumeOutcome = 'readable' | 'failed' | 'timeout'
type InterviewOutcome = 'done' | 'failed' | 'timeout' | 'unavailable'
type CacheCondition = 'cold' | 'repeat'
type Variant = 'baseline' | 'candidate'

interface Sample {
  fixtureId: string
  variant: Variant
  cacheCondition: CacheCondition
  acceptedMs: number | null
  runningObservedMs: number | null
  readableMs: number | null
  interviewReadyMs: number | null
  resume: ResumeOutcome
  interview: InterviewOutcome
  failureCode: string | null
}

function safeLocalEndpoint(value: string) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || !['/api/v1', '/api/v1/'].includes(url.pathname)) {
    throw new Error('使用独立运行的本地 Reffo API 地址，路径为 /api/v1')
  }
  return new URL(`${url.origin}/api/v1/`)
}

class ProbeError extends Error {
  constructor(readonly code: string) { super(code) }
}

async function readApi(client: Client, route: string, signal: AbortSignal, body?: unknown) {
  const response = await client.fetch(new URL(route, client.baseUrl), {
    redirect: 'error', signal,
    ...(body ? {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Reffo-Completion-Schema': 'resume-completion-v4'},
      body: JSON.stringify(body)} : {}),
  })
  if (!response.ok) throw new ProbeError(`HTTP_${response.status}`)
  const result = envelope.parse(await response.json())
  if (!result.success) throw new ProbeError('API_ERROR')
  return result.data
}

export async function observeGeneration(client: Client, fixture: Fixture, variant: Variant, cacheCondition: CacheCondition,
  onReadable?: (markdown: string) => void): Promise<Sample> {
  const requestId = randomUUID()
  const start = performance.now()
  const elapsed = () => Math.round(performance.now() - start)
  const deadline = AbortSignal.timeout(client.timeoutMs)
  const pause = () => Bun.sleep(Math.min(client.pollMs, Math.max(0, client.timeoutMs - elapsed())))
  const sample: Sample = {
    fixtureId: fixture.id, variant, cacheCondition,
    acceptedMs: null, runningObservedMs: null, readableMs: null, interviewReadyMs: null,
    resume: 'failed', interview: 'unavailable', failureCode: null,
  }

  try {
    let job = jobSummary.parse(await readApi(client, 'generation-jobs/', deadline, {
      request_id: requestId, resume_markdown: fixture.resume_markdown, jd_text: fixture.jd_text,
    }))
    if (job.id !== requestId) throw new ProbeError('JOB_ID_MISMATCH')
    sample.acceptedMs = elapsed()

    while (job.status === 'queued' || job.status === 'running') {
      if (job.status === 'running') sample.runningObservedMs ??= elapsed()
      await pause()
      job = jobSummary.parse(await readApi(client, `generation-jobs/${requestId}`, deadline))
      if (job.id !== requestId) throw new ProbeError('JOB_ID_MISMATCH')
    }
    if (job.status !== 'completed' || !job.history_id) {
      sample.failureCode = job.failure?.code ?? `JOB_${job.status.toUpperCase()}`
      return sample
    }

    const historyRoute = `resume-history/${encodeURIComponent(job.history_id)}`
    while (true) {
      const history = historyInfo.parse(await readApi(client, historyRoute, deadline))
      if (!history.optimized_content.trim() || !history.process_result.optimized.optimized_resume.trim()) {
        throw new ProbeError('RESUME_MISSING')
      }
      sample.resume = 'readable'
      if (sample.readableMs === null) {
        sample.readableMs = elapsed()
        onReadable?.(history.optimized_content)
      }
      const status = history.interview_task?.status ?? history.progress?.interview
      if ((status === 'done' || status === undefined) && history.process_result.interview) {
        sample.interview = 'done'
        sample.interviewReadyMs = elapsed()
        return sample
      }
      if (status === 'failed' || status === 'stale') {
        sample.interview = 'failed'
        sample.failureCode = status === 'failed' ? 'INTERVIEW_FAILED' : 'INTERVIEW_STALE'
        return sample
      }
      await pause()
    }
  } catch (error) {
    if (sample.resume === 'readable') sample.interview = deadline.aborted ? 'timeout' : 'failed'
    else if (deadline.aborted) sample.resume = 'timeout'
    sample.failureCode = deadline.aborted ? 'OBSERVATION_TIMEOUT' : error instanceof ProbeError ? error.code : 'OBSERVATION_ERROR'
    return sample
  }
}

function percentile(values: number[], fraction: number, denominator = values.length) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.ceil(denominator * fraction) - 1] ?? null
}

function summarize(samples: Sample[]) {
  const accepted = samples.filter(sample => sample.acceptedMs !== null)
  const observed = (key: 'acceptedMs' | 'runningObservedMs' | 'readableMs' | 'interviewReadyMs') => {
    const values = samples.flatMap(sample => sample[key] === null ? [] : [sample[key]])
    return {observed: values.length, p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95)}
  }
  const withinDeadline = (key: 'readableMs' | 'interviewReadyMs') => {
    const values = accepted.flatMap(sample => sample[key] === null ? [] : [sample[key]])
    return {observed: values.length, accepted: accepted.length,
      p50Ms: percentile(values, 0.5, accepted.length),
      p95Ms: percentile(values, 0.95, accepted.length)}
  }
  return {
    attempted: samples.length,
    accepted: accepted.length,
    resumeFailureRate: samples.length ? samples.filter(sample => sample.resume !== 'readable').length / samples.length : null,
    resume: Object.fromEntries(['readable', 'failed', 'timeout'].map(outcome => [outcome, samples.filter(sample => sample.resume === outcome).length])),
    interview: Object.fromEntries(['done', 'failed', 'timeout', 'unavailable'].map(outcome => [outcome, samples.filter(sample => sample.interview === outcome).length])),
    acceptedLatency: observed('acceptedMs'), runningObservedLatency: observed('runningObservedMs'),
    readableLatency: observed('readableMs'), interviewReadyLatency: observed('interviewReadyMs'),
    acceptedToReadableWithinDeadline: withinDeadline('readableMs'),
    acceptedToInterviewWithinDeadline: withinDeadline('interviewReadyMs'),
  }
}

export function reportGenerationComparison(samples: Sample[]) {
  return Object.fromEntries((['cold', 'repeat'] as const).map(cacheCondition => {
    const baseline = samples.filter(sample => sample.cacheCondition === cacheCondition && sample.variant === 'baseline')
    const candidate = samples.filter(sample => sample.cacheCondition === cacheCondition && sample.variant === 'candidate')
    const paired = baseline.flatMap(left => {
      const right = candidate.find(sample => sample.fixtureId === left.fixtureId)
      return left.readableMs !== null && right && right.readableMs !== null
        ? [right.readableMs - left.readableMs] : []
    })
    return [cacheCondition, {
      baseline: summarize(baseline), candidate: summarize(candidate),
      pairedReadableDelta: {paired: paired.length, p50Ms: percentile(paired, 0.5), p95Ms: percentile(paired, 0.95)},
    }]
  }))
}

function anonymousPair(fixture: Fixture, baseline: string, candidate: string) {
  const baselineId = randomInt(2) === 0 ? 'A' : 'B'
  const candidateId = baselineId === 'A' ? 'B' : 'A'
  return {
    review: {id: fixture.id, originalResume: fixture.resume_markdown, originalJob: fixture.jd_text,
      candidates: {A: baselineId === 'A' ? baseline : candidate, B: baselineId === 'A' ? candidate : baseline}},
    key: {id: fixture.id, baseline: baselineId, candidate: candidateId},
  }
}

async function main() {
  const {values} = parseArgs({options: {
    baseline: {type: 'string'}, candidate: {type: 'string'}, fixtures: {type: 'string'},
    'baseline-version': {type: 'string'}, 'candidate-version': {type: 'string'}, 'blind-output': {type: 'string'},
    'timeout-ms': {type: 'string', default: '480000'}, live: {type: 'boolean'}, help: {type: 'boolean'},
  }})
  if (values.help || !values.fixtures) {
    console.log('bun run scripts/compare-generation-jobs.ts --fixtures <JSON> --baseline <本地基线 /api/v1> --candidate <本地候选 /api/v1> [--live] [--timeout-ms 480000] [--blind-output <新目录>]')
    if (!values.fixtures && !values.help) process.exitCode = 1
    return
  }
  const contents = await readFile(values.fixtures, 'utf8')
  const fixtures = evaluationFixtures.parse(JSON.parse(contents))
  const fixtureDigest = createHash('sha256').update(contents).digest('hex')
  if (new Set(fixtures.map(fixture => fixture.id)).size !== fixtures.length) throw new Error('样本 id 必须唯一')
  if (new Set(fixtures.map(fixture => fixture.resume_markdown)).size !== fixtures.length) throw new Error('冷缓存样本需要使用互不重复的源简历')
  if (!values.live) {
    console.log(JSON.stringify({mode: 'dry-run', fixtureDigest, fixtures: fixtures.map(fixture => fixture.id), maxGenerationSubmissions: fixtures.length * 4}))
    return
  }
  if (!values.baseline || !values.candidate) throw new Error('需要同时提供基线和候选服务地址')
  const baseline = safeLocalEndpoint(values.baseline)
  const candidate = safeLocalEndpoint(values.candidate)
  if (baseline.origin === candidate.origin) throw new Error('基线和候选需要各自独立的服务进程')
  const timeoutMs = Number(values['timeout-ms'])
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 900_000) throw new Error('timeout-ms 范围为 1000 至 900000')
  if (values['blind-output']) await mkdir(values['blind-output'], {mode: 0o700})
  const clients = {baseline: {baseUrl: baseline, timeoutMs, pollMs: 500, fetch}, candidate: {baseUrl: candidate, timeoutMs, pollMs: 500, fetch}}
  const samples: Sample[] = []
  const blindPairs: ReturnType<typeof anonymousPair>[] = []
  for (const [index, fixture] of fixtures.entries()) {
    const variants: Variant[] = index % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline']
    const coldSamples: Sample[] = []
    const markdown: Partial<Record<Variant, string>> = {}
    for (const variant of variants) {
      coldSamples.push(await observeGeneration(clients[variant], fixture, variant, 'cold',
        values['blind-output'] ? value => { markdown[variant] = value } : undefined))
    }
    samples.push(...coldSamples)
    if (markdown.baseline && markdown.candidate) blindPairs.push(anonymousPair(fixture, markdown.baseline, markdown.candidate))
    if (coldSamples.some(sample => sample.resume === 'timeout' || sample.interview === 'timeout')) break
    if (coldSamples.every(sample => sample.resume === 'readable')) {
      const repeatSamples: Sample[] = []
      for (const variant of variants) {
        repeatSamples.push(await observeGeneration(clients[variant], fixture, variant, 'repeat'))
      }
      samples.push(...repeatSamples)
      if (repeatSamples.some(sample => sample.resume === 'timeout' || sample.interview === 'timeout')) break
    }
  }
  if (values['blind-output']) {
    const output = values['blind-output']
    const writePrivate = (name: string, value: unknown) => writeFile(join(output, name), JSON.stringify(value, null, 2), {mode: 0o600, flag: 'wx'})
    await Promise.all([
      writePrivate('review.json', blindPairs.map(pair => pair.review)),
      writePrivate('key.json', blindPairs.map(pair => pair.key)),
    ])
  }
  console.log(JSON.stringify({fixtureDigest, baselineVersion: values['baseline-version'] ?? null, candidateVersion: values['candidate-version'] ?? null,
    timeoutMs, pollMs: 500, plannedColdPairs: fixtures.length, blindPairs: values['blind-output'] ? blindPairs.length : null,
    samples, summary: reportGenerationComparison(samples)}, null, 2))
  if (samples.some(sample => sample.resume !== 'readable' || sample.interview !== 'done')) process.exitCode = 1
}

if (import.meta.main) await main().catch(error => {
  console.error(error instanceof z.ZodError ? '输入样本格式有误' : error instanceof Error ? error.message : '评测失败')
  process.exitCode = 1
})
