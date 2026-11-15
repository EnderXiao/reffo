import { describe, expect, test } from 'bun:test'
import { errorFingerprint } from './error-fingerprint'

describe('errorFingerprint', () => {
  test('相同错误产生相同指纹', () => {
    const a = errorFingerprint({ name: 'TypeError', message: 'Cannot read properties of undefined', stack: 'TypeError: Cannot read properties of undefined\n    at foo (/app/src/a.ts:10:1)' })
    const b = errorFingerprint({ name: 'TypeError', message: 'Cannot read properties of undefined', stack: 'TypeError: Cannot read properties of undefined\n    at foo (/app/src/a.ts:10:1)' })
    expect(a).toBe(b)
  })

  test('动态数字归一化后同类错误指纹相同', () => {
    const a = errorFingerprint({ name: 'Error', message: 'quota used 3 exceeds limit 5', stack: 'Error\n    at bar (/app/src/b.ts:1:1)' })
    const b = errorFingerprint({ name: 'Error', message: 'quota used 7 exceeds limit 9', stack: 'Error\n    at bar (/app/src/b.ts:1:1)' })
    expect(a).toBe(b)
  })

  test('不同错误位置或类型产生不同指纹', () => {
    const a = errorFingerprint({ name: 'TypeError', message: 'boom', stack: 'at foo (/a.ts:1:1)' })
    const b = errorFingerprint({ name: 'TypeError', message: 'boom', stack: 'at foo (/b.ts:1:1)' })
    expect(a).not.toBe(b)
  })

  test('无 stack 也能生成指纹', () => {
    const fp = errorFingerprint({ name: 'Error', message: 'no stack' })
    expect(fp).toMatch(/^[0-9a-f]{16}$/)
  })
})
