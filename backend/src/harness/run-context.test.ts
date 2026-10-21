import { expect, test } from 'bun:test'
import { createCanonicalDigest } from './run-context'

test('canonical digest ignores object key order without ignoring values or array order', () => {
  expect(createCanonicalDigest({a: 1, nested: {left: true, right: false}}))
    .toBe(createCanonicalDigest({nested: {right: false, left: true}, a: 1}))
  expect(createCanonicalDigest({items: ['first', 'second']}))
    .not.toBe(createCanonicalDigest({items: ['second', 'first']}))
  expect(createCanonicalDigest({value: 1})).not.toBe(createCanonicalDigest({value: 2}))
})
