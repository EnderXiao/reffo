import { z } from 'zod'
import { createDigest } from '@/harness/run-context'
import { V5_SCHEMA_VERSION } from '@/v5/types'

const nonEmptyString = z.string().min(1)

export const repairPatchOperationSchema = z.object({
  operationId: nonEmptyString,
  op: z.enum(['replace', 'remove']),
  path: nonEmptyString,
  originalDigest: z.string().nullable(),
  value: z.unknown(),
  evidenceIds: z.array(nonEmptyString),
  sourceBlockIds: z.array(nonEmptyString),
  reason: nonEmptyString,
}).strict()

export const repairPatchSchema = z.object({
  schemaVersion: z.literal(V5_SCHEMA_VERSION),
  operations: z.array(repairPatchOperationSchema).max(20),
}).strict()

export type RepairPatch = z.infer<typeof repairPatchSchema>

export class RepairPatchMergeError extends Error {
  readonly code = 'V6_REPAIR_PATCH_REJECTED' as const

  constructor(readonly reason: string) {
    super(`V6 RepairPatch rejected: ${reason}`)
    this.name = 'RepairPatchMergeError'
  }
}

function segments(path: string) {
  return path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
}

function getAtPath(root: unknown, path: string) {
  let value = root
  for (const segment of segments(path)) {
    if (Array.isArray(value)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= value.length) return undefined
      value = value[index]
    } else if (typeof value === 'object' && value !== null) {
      value = (value as Record<string, unknown>)[segment]
    } else return undefined
  }
  return value
}

function setAtPath(root: unknown, path: string, value: unknown, op: RepairPatch['operations'][number]['op']) {
  const pathParts = segments(path)
  if (pathParts.length === 0) throw new RepairPatchMergeError('path 不能为空')
  let parent = root as Record<string, unknown> | unknown[]
  for (let index = 0; index < pathParts.length - 1; index += 1) {
    const segment = pathParts[index]
    const child = Array.isArray(parent) ? parent[Number(segment)] : parent[segment]
    if (child === undefined || child === null || typeof child !== 'object') {
      throw new RepairPatchMergeError(`path 父级不存在：${path}`)
    }
    parent = child as Record<string, unknown> | unknown[]
  }
  const leaf = pathParts[pathParts.length - 1]
  if (Array.isArray(parent)) {
    const index = Number(leaf)
    if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
      throw new RepairPatchMergeError(`path 数组索引不存在：${path}`)
    }
    if (op === 'remove') parent.splice(index, 1)
    else parent[index] = value
  } else {
    if (!(leaf in parent)) throw new RepairPatchMergeError(`path 字段不存在：${path}`)
    if (op === 'remove') delete parent[leaf]
    else parent[leaf] = value
  }
}

function isAllowedPath(path: string, allowedPaths: readonly string[]) {
  return allowedPaths.some(allowed => allowed === path)
}

export function mergeRepairPatch(input: {
  currentOutput: unknown
  patch: unknown
  allowedPaths: readonly string[]
}) {
  const parsed = repairPatchSchema.safeParse(input.patch)
  if (!parsed.success) throw new RepairPatchMergeError('Patch Schema 校验失败')
  const output = structuredClone(input.currentOutput)
  const operationIds = new Set<string>()
  const paths = new Set<string>()

  for (const operation of parsed.data.operations) {
    if (operationIds.has(operation.operationId)) {
      throw new RepairPatchMergeError(`重复 operationId：${operation.operationId}`)
    }
    if (paths.has(operation.path)) throw new RepairPatchMergeError(`重复 path：${operation.path}`)
    if (!isAllowedPath(operation.path, input.allowedPaths)) {
      throw new RepairPatchMergeError(`path 未获授权：${operation.path}`)
    }
    const current = getAtPath(output, operation.path)
    if (current === undefined) throw new RepairPatchMergeError(`path 当前值不存在：${operation.path}`)
    if (operation.originalDigest !== null && createDigest(current) !== operation.originalDigest) {
      throw new RepairPatchMergeError(`path 原值摘要不匹配：${operation.path}`)
    }
    setAtPath(output, operation.path, operation.value, operation.op)
    operationIds.add(operation.operationId)
    paths.add(operation.path)
  }

  return { value: output, patch: parsed.data }
}
