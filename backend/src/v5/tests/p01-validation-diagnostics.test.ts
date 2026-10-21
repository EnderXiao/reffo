import { describe, expect, test } from 'bun:test'
import {
  P01_VALIDATION_OBSERVATION_VERSION,
  aggregateP01ValidationObservations,
  bucketP01ValidationIssues,
  buildP01ValidationTrace,
  p01ValidationPathCategory,
  sanitizeP01ValidationObservation,
  type P01ValidationIssueBucket,
  type P01ValidationObservationV1,
} from '@/v5/p01-validation-diagnostics'

const PII_CANARY = 'PII_CANARY_resume_text@example.com_13800138000'

function observation(input: {
  shardIndex: number
  shardCount?: number
  component?: 'P01' | 'P01R'
  attempt?: 0 | 1
  layer?: 'schema' | 'domain' | 'repair_gate'
  outcome?: 'passed' | 'failed' | 'blocked_before_call'
  issueBuckets?: P01ValidationIssueBucket[]
}): P01ValidationObservationV1 {
  return {
    version: P01_VALIDATION_OBSERVATION_VERSION,
    shardIndex: input.shardIndex,
    shardCount: input.shardCount ?? 2,
    component: input.component ?? 'P01',
    attempt: input.attempt ?? 0,
    layer: input.layer ?? 'domain',
    outcome: input.outcome ?? 'failed',
    issueBuckets: input.issueBuckets ?? [],
  }
}

describe('P01 validation diagnostics privacy projection', () => {
  test('buckets only allowlisted issue dimensions and drops PII-bearing fields', () => {
    const buckets = bucketP01ValidationIssues([
      {
        code: 'BUSINESS_FACT_WITHOUT_TIMELINE',
        severity: 'error',
        outputPath: 'factCandidates[0].sourceQuote',
        message: PII_CANARY,
        claimId: PII_CANARY,
        evidenceIds: [PII_CANARY],
      },
      {
        code: 'BUSINESS_FACT_WITHOUT_TIMELINE',
        severity: 'error',
        outputPath: 'factCandidates[7].numericAtoms',
        replacementText: PII_CANARY,
      },
      {
        code: `UNKNOWN_${PII_CANARY}`,
        severity: 'warning',
        outputPath: `private.${PII_CANARY}`,
        expectedConstraint: PII_CANARY,
      },
    ], 'domain')

    expect(buckets).toEqual([
      {
        code: 'BUSINESS_FACT_WITHOUT_TIMELINE',
        severity: 'error',
        pathCategory: 'fact',
        count: 2,
      },
      {
        code: 'UNCLASSIFIED_VALIDATION_ISSUE',
        severity: 'warning',
        pathCategory: 'other',
        count: 1,
      },
    ])
    expect(JSON.stringify(buckets)).not.toContain(PII_CANARY)
    expect(JSON.stringify(buckets)).not.toContain('sourceQuote')
  })

  test('normalizes known schema codes and folds unknown code and path values', () => {
    expect(bucketP01ValidationIssues([
      { code: 'invalid_type', path: ['identityCandidates', 0, 'value'], message: PII_CANARY },
      { code: `future_${PII_CANARY}`, path: `private.${PII_CANARY}`, message: PII_CANARY },
      { code: 'V5_JSON_PARSE_FAILED', path: null, message: PII_CANARY },
    ], 'schema')).toEqual([
      { code: 'SCHEMA_INVALID_TYPE', severity: 'error', pathCategory: 'identity', count: 1 },
      { code: 'SCHEMA_UNCLASSIFIED', severity: 'error', pathCategory: 'other', count: 1 },
      { code: 'V5_JSON_PARSE_FAILED', severity: 'error', pathCategory: 'root', count: 1 },
    ])

    expect(p01ValidationPathCategory('coverageClaim.coveredSourceBlockIds')).toBe('coverage')
    expect(p01ValidationPathCategory('conflicts[0].factLocalIds')).toBe('conflict')
    expect(p01ValidationPathCategory(`private.${PII_CANARY}`)).toBe('other')
  })

  test('re-projects observations with exact safe fields and rejects invalid semantics', () => {
    const sanitized = sanitizeP01ValidationObservation({
      ...observation({
        shardIndex: 0,
        issueBuckets: [],
      }),
      issueBuckets: [{
        code: 'BUSINESS_FACT_WITHOUT_TIMELINE',
        severity: 'error',
        pathCategory: 'fact',
        count: 2,
        message: PII_CANARY,
      }],
      resumeContent: PII_CANARY,
      rawPath: PII_CANARY,
      validationMessage: PII_CANARY,
    })

    expect(sanitized).toEqual(observation({
      shardIndex: 0,
      issueBuckets: [{
        code: 'BUSINESS_FACT_WITHOUT_TIMELINE',
        severity: 'error',
        pathCategory: 'fact',
        count: 2,
      }],
    }))
    expect(JSON.stringify(sanitized)).not.toContain(PII_CANARY)
    expect(sanitizeP01ValidationObservation(observation({
      shardIndex: 0,
      component: 'P01',
      attempt: 1,
    }))).toBeNull()
    expect(sanitizeP01ValidationObservation(observation({
      shardIndex: 2,
      shardCount: 2,
    }))).toBeNull()
    expect(sanitizeP01ValidationObservation(observation({
      shardIndex: 0,
      component: 'P01',
      attempt: 0,
      layer: 'repair_gate',
      outcome: 'blocked_before_call',
    }))).toBeNull()
  })
})

describe('P01 validation diagnostics aggregation', () => {
  test('coalesces duplicate buckets and sorts independently of provider completion order', () => {
    const values = [
      observation({
        shardIndex: 1,
        issueBuckets: [{
          code: 'SOURCE_QUOTE_NOT_FOUND',
          severity: 'error',
          pathCategory: 'fact',
          count: 1,
        }],
      }),
      observation({
        shardIndex: 0,
        component: 'P01R',
        attempt: 1,
        outcome: 'passed',
      }),
      observation({
        shardIndex: 0,
        layer: 'schema',
        issueBuckets: [{
          code: 'SCHEMA_INVALID_TYPE',
          severity: 'error',
          pathCategory: 'fact',
          count: 2,
        }],
      }),
      observation({
        shardIndex: 0,
        layer: 'schema',
        issueBuckets: [{
          code: 'SCHEMA_INVALID_TYPE',
          severity: 'error',
          pathCategory: 'fact',
          count: 3,
        }],
      }),
      { version: P01_VALIDATION_OBSERVATION_VERSION, shardIndex: PII_CANARY },
    ]

    const expected = [
      observation({
        shardIndex: 0,
        layer: 'schema',
        issueBuckets: [{
          code: 'SCHEMA_INVALID_TYPE',
          severity: 'error',
          pathCategory: 'fact',
          count: 5,
        }],
      }),
      observation({
        shardIndex: 0,
        component: 'P01R',
        attempt: 1,
        outcome: 'passed',
      }),
      observation({
        shardIndex: 1,
        issueBuckets: [{
          code: 'SOURCE_QUOTE_NOT_FOUND',
          severity: 'error',
          pathCategory: 'fact',
          count: 1,
        }],
      }),
    ]
    expect(aggregateP01ValidationObservations(values)).toEqual(expected)
    expect(aggregateP01ValidationObservations([...values].reverse())).toEqual(expected)
    expect(buildP01ValidationTrace({
      captureStatus: 'complete',
      source: 'live',
      shardCount: 2,
      observations: values,
    })).toEqual({
      version: 'v5-p01-validation-trace-v1',
      captureStatus: 'complete',
      source: 'live',
      shardCount: 2,
      records: expected,
    })
  })

  test('keeps cache traces explicitly unobserved and rejects inconsistent trace bounds', () => {
    expect(buildP01ValidationTrace({
      captureStatus: 'not_observed',
      source: 'trusted_cache',
      shardCount: 3,
      observations: [],
    })).toEqual({
      version: 'v5-p01-validation-trace-v1',
      captureStatus: 'not_observed',
      source: 'trusted_cache',
      shardCount: 3,
      records: [],
    })
    expect(buildP01ValidationTrace({
      captureStatus: 'partial',
      source: 'live',
      shardCount: 3,
      observations: [observation({ shardIndex: 0, shardCount: 2 })],
    })).toBeNull()
  })
})
