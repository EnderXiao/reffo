const PINYIN_INITIAL_BOUNDARIES: Array<{initial: string; char: string}> = [
  {initial: 'A', char: '阿'},
  {initial: 'B', char: '八'},
  {initial: 'C', char: '嚓'},
  {initial: 'D', char: '咑'},
  {initial: 'E', char: '妸'},
  {initial: 'F', char: '发'},
  {initial: 'G', char: '旮'},
  {initial: 'H', char: '哈'},
  {initial: 'J', char: '讥'},
  {initial: 'K', char: '咔'},
  {initial: 'L', char: '垃'},
  {initial: 'M', char: '妈'},
  {initial: 'N', char: '拿'},
  {initial: 'O', char: '噢'},
  {initial: 'P', char: '妑'},
  {initial: 'Q', char: '七'},
  {initial: 'R', char: '呥'},
  {initial: 'S', char: '仨'},
  {initial: 'T', char: '他'},
  {initial: 'W', char: '哇'},
  {initial: 'X', char: '夕'},
  {initial: 'Y', char: '丫'},
  {initial: 'Z', char: '帀'},
]

const pinyinCollator = typeof Intl !== 'undefined' && typeof Intl.Collator === 'function'
  ? new Intl.Collator('zh-Hans-u-co-pinyin', {
    usage: 'sort',
    sensitivity: 'base',
  })
  : null

function isLatinLetter(char: string) {
  return /^[A-Za-z]$/.test(char)
}

function isHanChar(char: string) {
  return /[\u3400-\u9fff]/.test(char)
}

function isMeaningfulInitialChar(char: string) {
  return isLatinLetter(char) || isHanChar(char)
}

function compareByPinyinOrder(left: string, right: string) {
  return pinyinCollator?.compare(left, right) ?? left.localeCompare(right, 'zh-Hans-u-co-pinyin')
}

function resolveHanInitial(char: string) {
  let start = 0
  let end = PINYIN_INITIAL_BOUNDARIES.length - 1
  let matchedInitial: string | null = null

  while (start <= end) {
    const mid = Math.floor((start + end) / 2)
    const boundary = PINYIN_INITIAL_BOUNDARIES[mid]

    if (compareByPinyinOrder(char, boundary.char) >= 0) {
      matchedInitial = boundary.initial
      start = mid + 1
    } else {
      end = mid - 1
    }
  }

  return matchedInitial
}

export function resolveTextInitial(value: string): string | null {
  const firstMeaningfulChar = Array.from(value.trim()).find(isMeaningfulInitialChar)

  if (!firstMeaningfulChar) {
    return null
  }

  if (isLatinLetter(firstMeaningfulChar)) {
    return firstMeaningfulChar.toUpperCase()
  }

  return resolveHanInitial(firstMeaningfulChar)
}
