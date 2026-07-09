import {resolveTextInitial} from '@/utils/text-initial'

describe('resolveTextInitial', () => {
  test('returns uppercase Latin initials', () => {
    expect(resolveTextInitial(' openai')).toBe('O')
    expect(resolveTextInitial('miHoYo')).toBe('M')
  })

  test('skips non-letter prefixes', () => {
    expect(resolveTextInitial('｜芒果 TV')).toBe('M')
    expect(resolveTextInitial('2026 小米集团')).toBe('X')
  })

  test('resolves common Chinese company initials by pinyin order', () => {
    expect(resolveTextInitial('飞书科技')).toBe('F')
    expect(resolveTextInitial('携程旅行网')).toBe('X')
    expect(resolveTextInitial('滴滴出行')).toBe('D')
    expect(resolveTextInitial('饿了么')).toBe('E')
    expect(resolveTextInitial('华为技术有限公司')).toBe('H')
    expect(resolveTextInitial('中兴通讯')).toBe('Z')
  })

  test('returns null when no meaningful initial exists', () => {
    expect(resolveTextInitial('  --  ')).toBeNull()
  })
})
