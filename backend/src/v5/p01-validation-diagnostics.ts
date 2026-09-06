export const P01_VALIDATION_OBSERVATION_VERSION = 'v5-p01-validation-observation-v1' as const
export const P01_VALIDATION_TRACE_VERSION = 'v5-p01-validation-trace-v1' as const

export type P01ValidationComponent = 'P01' | 'P01R'
export type P01ValidationAttempt = 0 | 1
export type P01ValidationLayer = 'schema' | 'domain' | 'repair_gate'
export type P01ValidationOutcome = 'passed' | 'failed' | 'blocked_before_call'
export type P01ValidationSeverity = 'error' | 'warning' | 'info'
export type P01ValidationPathCategory =
  | 'root'
  | 'schema'
  | 'identity'
  | 'timeline'
  | 'section'
  | 'fact'
  | 'unmapped'
  | 'conflict'
  | 'coverage'
  | 'quality_assessment'
  | 'other'

export interface P01ValidationIssueBucket {
  code: string
  severity: P01ValidationSeverity
  pathCategory: P01ValidationPathCategory
  count: number
}

export interface P01ValidationObservationV1 {
  version: typeof P01_VALIDATION_OBSERVATION_VERSION
  shardIndex: number
  shardCount: number
  component: P01ValidationComponent
  attempt: P01ValidationAttempt
  layer: P01ValidationLayer
  outcome: P01ValidationOutcome
  issueBuckets: P01ValidationIssueBucket[]
}

export interface P01ValidationTraceV1 {
  version: typeof P01_VALIDATION_TRACE_VERSION
  captureStatus: 'complete' | 'partial' | 'not_observed'
  source: 'live' | 'trusted_cache'
  shardCount: number
  records: P01ValidationObservationV1[]
}

const MAX_SHARD_COUNT = 10_000
const MAX_RAW_ISSUES = 512
const MAX_ISSUE_BUCKETS = 64
const MAX_BUCKET_COUNT = 1_000_000

const COMPONENTS = ['P01', 'P01R'] as const
const LAYERS = ['schema', 'domain', 'repair_gate'] as const
const OUTCOMES = ['passed', 'failed', 'blocked_before_call'] as const
const SEVERITIES = ['error', 'warning', 'info'] as const
const PATH_CATEGORIES = [
  'root',
  'schema',
  'identity',
  'timeline',
  'section',
  'fact',
  'unmapped',
  'conflict',
  'coverage',
  'quality_assessment',
  'other',
] as const

const UNCLASSIFIED_ISSUE_CODE = 'UNCLASSIFIED_VALIDATION_ISSUE'
const SCHEMA_UNCLASSIFIED_ISSUE_CODE = 'SCHEMA_UNCLASSIFIED'
const BUCKET_OVERFLOW_ISSUE_CODE = 'DIAGNOSTICS_BUCKET_OVERFLOW'

const P01_DOMAIN_ISSUE_CODES = new Set([
  'BLOCK_SILENTLY_DROPPED',
  'BUSINESS_FACT_WITHOUT_TIMELINE',
  'CONFLICT_QUALIFIER_MISSING',
  'COVERAGE_CLAIM_MISMATCH',
  'COVERAGE_SET_OVERLAP',
  'DETAILED_LOCATION_IDENTITY_DROPPED',
  'DUPLICATE_FACT_CANDIDATE',
  'FACT_CANDIDATE_ABSOLUTE_LIMIT_EXCEEDED',
  'FACT_CANDIDATE_BLOCK_DENSITY_EXCEEDED',
  'FACT_CANDIDATE_DENSITY_EXCEEDED',
  'FACT_CANDIDATE_PARTITION_SERVER_COALESCED',
  'FACT_CANDIDATE_SOURCE_OVERLAP',
  'FACT_CANDIDATE_TRANSPORT_LIMIT_EXCEEDED',
  'HIGH_IMPORTANCE_AMBIGUITY_SERVER_EXCLUDED',
  'HIGH_IMPORTANCE_UNMAPPED',
  'INVALID_IDENTITY_INFERENCE',
  'LAYOUT_ONLY_BLOCK_AUTO_UNMAPPED',
  'NUMERIC_ATOMS_SERVER_ALIGNED',
  'OVERLAPPING_UNMAPPED_FRAGMENT_DROPPED',
  'PROMPT_INJECTION_EVIDENCE_ENABLED',
  'SCOPE_COLLISION',
  'SILENT_SOURCE_BLOCK_SERVER_EXCLUDED',
  'SOURCE_QUOTE_NOT_FOUND',
  'SOURCE_QUOTE_SPAN_SERVER_ALIGNED',
  'SOURCE_SCOPE_CHILD_SECTION_INHERITED',
  'SOURCE_SCOPE_SECTION_MISMATCH',
  'SOURCE_SPAN_MISMATCH',
  'TIMELINE_VALUE_UNSUPPORTED',
  'UNKNOWN_DERIVED_REFERENCE_DROPPED',
  'UNKNOWN_FACT_REFERENCE',
  'UNKNOWN_SECTION_REFERENCE',
  'UNRESOLVED_CONFLICT_ENABLED',
  'UNRESOLVED_CONFLICT_SERVER_EXCLUDED',
  'UNSAFE_EVIDENCE_STATUS',
  'RISK_STATUS_SERVER_DOWNGRADED',
  'UNSUPPORTED_TIMELINE_VALUE_DROPPED',
])

const STRUCTURED_OUTPUT_ISSUE_CODES = new Set([
  'V5_JSON_PARSE_FAILED',
  'V5_OUTPUT_TRUNCATED',
  'V5_SCHEMA_VALIDATION_FAILED',
])

const REPAIR_GATE_ISSUE_CODES = new Set([
  'P01_REPAIR_BUDGET_EXHAUSTED',
])

const ZOD_ISSUE_CODES = new Set([
  'custom',
  'invalid_arguments',
  'invalid_date',
  'invalid_enum_value',
  'invalid_intersection_types',
  'invalid_literal',
  'invalid_return_type',
  'invalid_string',
  'invalid_type',
  'invalid_union',
  'invalid_union_discriminator',
  'not_finite',
  'not_multiple_of',
  'too_big',
  'too_small',
  'unrecognized_keys',
])
const NORMALIZED_SCHEMA_ISSUE_CODES = new Set(
  [...ZOD_ISSUE_CODES].map(code => `SCHEMA_${code.toUpperCase()}`)
)
const INTERNAL_ISSUE_CODES = new Set([
  UNCLASSIFIED_ISSUE_CODE,
  SCHEMA_UNCLASSIFIED_ISSUE_CODE,
  BUCKET_OVERFLOW_ISSUE_CODE,
])

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asEnum<const TValues extends readonly string[]>(value: unknown, values: TValues): TValues[number] | null {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
    ? value as TValues[number]
    : null
}

function asInteger(value: unknown, minimum: number, maximum: number) {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum
    ? value
    : null
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizeIssueCode(value: unknown, layer: P01ValidationLayer) {
  if (typeof value !== 'string') {
    return layer === 'schema' ? SCHEMA_UNCLASSIFIED_ISSUE_CODE : UNCLASSIFIED_ISSUE_CODE
  }
  if (INTERNAL_ISSUE_CODES.has(value)) return value
  if (layer === 'schema') {
    if (STRUCTURED_OUTPUT_ISSUE_CODES.has(value)) return value
    if (NORMALIZED_SCHEMA_ISSUE_CODES.has(value)) return value
    if (ZOD_ISSUE_CODES.has(value)) return `SCHEMA_${value.toUpperCase()}`
    return SCHEMA_UNCLASSIFIED_ISSUE_CODE
  }
  if (layer === 'repair_gate') {
    return REPAIR_GATE_ISSUE_CODES.has(value) ? value : UNCLASSIFIED_ISSUE_CODE
  }
  return P01_DOMAIN_ISSUE_CODES.has(value) ? value : UNCLASSIFIED_ISSUE_CODE
}

export function p01ValidationPathCategory(value: unknown): P01ValidationPathCategory {
  if (value === null || value === undefined || value === '') return 'root'
  const firstSegment = Array.isArray(value) ? value[0] : value
  if (typeof firstSegment !== 'string') return 'other'
  const startsWithPathSegment = (segment: string) => firstSegment === segment
    || firstSegment.startsWith(`${segment}.`)
    || firstSegment.startsWith(`${segment}[`)
    || firstSegment.startsWith(`${segment}/`)
  if (startsWithPathSegment('schemaVersion')) return 'schema'
  if (startsWithPathSegment('identityCandidates')) return 'identity'
  if (startsWithPathSegment('timelineCandidates')) return 'timeline'
  if (startsWithPathSegment('sectionCandidates')) return 'section'
  if (startsWithPathSegment('factCandidates')) return 'fact'
  if (startsWithPathSegment('unmappedFragments')) return 'unmapped'
  if (startsWithPathSegment('conflicts')) return 'conflict'
  if (startsWithPathSegment('coverageClaim')) return 'coverage'
  if (startsWithPathSegment('qualityAssessment')) return 'quality_assessment'
  return 'other'
}

function bucketComparator(left: P01ValidationIssueBucket, right: P01ValidationIssueBucket) {
  return compareText(left.code, right.code)
    || compareText(left.severity, right.severity)
    || compareText(left.pathCategory, right.pathCategory)
}

function bucketKey(bucket: Omit<P01ValidationIssueBucket, 'count'>) {
  return `${bucket.code}\u0000${bucket.severity}\u0000${bucket.pathCategory}`
}

function boundedBuckets(values: P01ValidationIssueBucket[]) {
  const ordered = values.sort(bucketComparator)
  if (ordered.length <= MAX_ISSUE_BUCKETS) return ordered
  const retained = ordered.slice(0, MAX_ISSUE_BUCKETS - 1)
  const overflowCount = ordered.slice(MAX_ISSUE_BUCKETS - 1)
    .reduce((sum, item) => Math.min(MAX_BUCKET_COUNT, sum + item.count), 0)
  retained.push({
    code: BUCKET_OVERFLOW_ISSUE_CODE,
    severity: 'error',
    pathCategory: 'other',
    count: overflowCount,
  })
  return retained.sort(bucketComparator)
}

export function bucketP01ValidationIssues(
  value: unknown,
  layer: P01ValidationLayer
): P01ValidationIssueBucket[] {
  if (!Array.isArray(value)) return []
  const counts = new Map<string, P01ValidationIssueBucket>()
  for (const item of value.slice(0, MAX_RAW_ISSUES)) {
    const issue = asRecord(item)
    if (!issue) continue
    const severity = asEnum(issue.severity, SEVERITIES) ?? 'error'
    const pathCategory = p01ValidationPathCategory(issue.outputPath ?? issue.path)
    const bucket = {
      code: normalizeIssueCode(issue.code, layer),
      severity,
      pathCategory,
    }
    const key = bucketKey(bucket)
    const previous = counts.get(key)
    counts.set(key, {
      ...bucket,
      count: Math.min(MAX_BUCKET_COUNT, (previous?.count ?? 0) + 1),
    })
  }
  return boundedBuckets([...counts.values()])
}

function sanitizeIssueBuckets(value: unknown, layer: P01ValidationLayer) {
  if (!Array.isArray(value) || value.length > MAX_ISSUE_BUCKETS) return null
  const counts = new Map<string, P01ValidationIssueBucket>()
  for (const item of value) {
    const bucket = asRecord(item)
    if (!bucket) return null
    const severity = asEnum(bucket.severity, SEVERITIES)
    const pathCategory = asEnum(bucket.pathCategory, PATH_CATEGORIES)
    const count = asInteger(bucket.count, 1, MAX_BUCKET_COUNT)
    if (!severity || !pathCategory || count === null) return null
    const projected = {
      code: normalizeIssueCode(bucket.code, layer),
      severity,
      pathCategory,
    }
    const key = bucketKey(projected)
    const previous = counts.get(key)
    counts.set(key, {
      ...projected,
      count: Math.min(MAX_BUCKET_COUNT, (previous?.count ?? 0) + count),
    })
  }
  return boundedBuckets([...counts.values()])
}

function mergeIssueBuckets(
  left: P01ValidationIssueBucket[],
  right: P01ValidationIssueBucket[]
) {
  const counts = new Map<string, P01ValidationIssueBucket>()
  for (const bucket of [...left, ...right]) {
    const key = bucketKey(bucket)
    const previous = counts.get(key)
    counts.set(key, {
      ...bucket,
      count: Math.min(MAX_BUCKET_COUNT, (previous?.count ?? 0) + bucket.count),
    })
  }
  return boundedBuckets([...counts.values()])
}

function observationSemanticsAreValid(input: {
  component: P01ValidationComponent
  attempt: P01ValidationAttempt
  layer: P01ValidationLayer
  outcome: P01ValidationOutcome
}) {
  if (input.component === 'P01' && input.attempt !== 0) return false
  if (input.component === 'P01R' && input.attempt !== 1) return false
  if (input.layer === 'repair_gate') {
    return input.component === 'P01R' && input.outcome === 'blocked_before_call'
  }
  return input.outcome !== 'blocked_before_call'
}

/**
 * Re-projects an event at the storage boundary. Only fixed enums, bounded
 * integers and allowlisted issue codes survive; model-controlled strings never do.
 */
export function sanitizeP01ValidationObservation(value: unknown): P01ValidationObservationV1 | null {
  const observation = asRecord(value)
  if (!observation || observation.version !== P01_VALIDATION_OBSERVATION_VERSION) return null
  const shardIndex = asInteger(observation.shardIndex, 0, MAX_SHARD_COUNT - 1)
  const shardCount = asInteger(observation.shardCount, 1, MAX_SHARD_COUNT)
  const component = asEnum(observation.component, COMPONENTS)
  const attempt = observation.attempt === 0 || observation.attempt === 1 ? observation.attempt : null
  const layer = asEnum(observation.layer, LAYERS)
  const outcome = asEnum(observation.outcome, OUTCOMES)
  if (
    shardIndex === null
    || shardCount === null
    || shardIndex >= shardCount
    || !component
    || attempt === null
    || !layer
    || !outcome
    || !observationSemanticsAreValid({ component, attempt, layer, outcome })
  ) return null
  const issueBuckets = sanitizeIssueBuckets(observation.issueBuckets, layer)
  if (!issueBuckets) return null
  return {
    version: P01_VALIDATION_OBSERVATION_VERSION,
    shardIndex,
    shardCount,
    component,
    attempt,
    layer,
    outcome,
    issueBuckets,
  }
}

function observationKey(value: P01ValidationObservationV1) {
  return [
    value.shardIndex,
    value.shardCount,
    value.component,
    value.attempt,
    value.layer,
    value.outcome,
  ].join('\u0000')
}

function observationComparator(left: P01ValidationObservationV1, right: P01ValidationObservationV1) {
  const layerOrder: Record<P01ValidationLayer, number> = { schema: 0, domain: 1, repair_gate: 2 }
  const outcomeOrder: Record<P01ValidationOutcome, number> = { passed: 0, failed: 1, blocked_before_call: 2 }
  return left.shardIndex - right.shardIndex
    || left.attempt - right.attempt
    || compareText(left.component, right.component)
    || layerOrder[left.layer] - layerOrder[right.layer]
    || outcomeOrder[left.outcome] - outcomeOrder[right.outcome]
    || left.shardCount - right.shardCount
}

/** Drops invalid observations, coalesces identical records and returns stable order. */
export function aggregateP01ValidationObservations(values: readonly unknown[]) {
  const observations = new Map<string, P01ValidationObservationV1>()
  for (const value of values) {
    const sanitized = sanitizeP01ValidationObservation(value)
    if (!sanitized) continue
    const key = observationKey(sanitized)
    const previous = observations.get(key)
    if (!previous) {
      observations.set(key, sanitized)
      continue
    }
    observations.set(key, {
      ...sanitized,
      issueBuckets: mergeIssueBuckets(previous.issueBuckets, sanitized.issueBuckets),
    })
  }
  return [...observations.values()].sort(observationComparator)
}

export function buildP01ValidationTrace(input: {
  captureStatus: P01ValidationTraceV1['captureStatus']
  source: P01ValidationTraceV1['source']
  shardCount: number
  observations: readonly unknown[]
}): P01ValidationTraceV1 | null {
  const captureStatus = asEnum(input.captureStatus, ['complete', 'partial', 'not_observed'] as const)
  const source = asEnum(input.source, ['live', 'trusted_cache'] as const)
  const shardCount = asInteger(input.shardCount, 1, MAX_SHARD_COUNT)
  if (!captureStatus || !source || shardCount === null) return null
  const records = aggregateP01ValidationObservations(input.observations)
  if (records.some(item => item.shardCount !== shardCount)) return null
  if (source === 'trusted_cache' && records.length > 0) return null
  if (captureStatus === 'not_observed' && records.length > 0) return null
  return {
    version: P01_VALIDATION_TRACE_VERSION,
    captureStatus,
    source,
    shardCount,
    records,
  }
}
