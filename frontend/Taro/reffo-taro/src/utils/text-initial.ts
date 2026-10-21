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

const PINYIN_SYLLABLE_OVERRIDES: Record<string, string> = {
  '拼': 'pin',
  '品': 'pin',
  '苹': 'ping',
  '平': 'ping',
  '鹏': 'peng',
  '跑': 'pao',
  '北': 'bei',
  '百': 'bai',
  '宝': 'bao',
  '不': 'bu',
  '大': 'da',
  '东': 'dong',
  '飞': 'fei',
  '方': 'fang',
  '海': 'hai',
  '华': 'hua',
  '汉': 'han',
  '好': 'hao',
  '金': 'jin',
  '开': 'kai',
  '来': 'lai',
  '乐': 'le',
  '美': 'mei',
  '南': 'nan',
  '牛': 'niu',
  '青': 'qing',
  '人': 'ren',
  '三': 'san',
  '山': 'shan',
  '上': 'shang',
  '生': 'sheng',
  '十': 'shi',
  '四': 'si',
  '天': 'tian',
  '万': 'wan',
  '西': 'xi',
  '小': 'xiao',
  '新': 'xin',
  '学': 'xue',
  '一': 'yi',
  '云': 'yun',
  '中': 'zhong',
  '字': 'zi',
  '携': 'xie',
  '滴': 'di',
  '豆': 'dou',
  '饿': 'e',
  '阿': 'a',
  '哈': 'ha',
  '七': 'qi',
  '奇': 'qi',
  '妈': 'ma',
  '拿': 'na',
  '噢': 'o',
}

const DEFAULT_SECOND_PINYIN_LETTER: Record<string, string> = {
  A: 'a',
  B: 'i',
  C: 'a',
  D: 'a',
  E: 'e',
  F: 'a',
  G: 'a',
  H: 'a',
  J: 'i',
  K: 'a',
  L: 'a',
  M: 'a',
  N: 'a',
  O: 'u',
  P: 'i',
  Q: 'i',
  R: 'a',
  S: 'a',
  T: 'a',
  W: 'a',
  X: 'i',
  Y: 'a',
  Z: 'a',
}

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

export function resolveTextSecondary(value: string): string | null {
  const trimmed = value.trim()
  const firstMeaningfulChar = Array.from(trimmed).find(isMeaningfulInitialChar)

  if (!firstMeaningfulChar) {
    return null
  }

  if (isLatinLetter(firstMeaningfulChar)) {
    const firstWord = trimmed.match(/[A-Za-z]+/u)?.[0] ?? firstMeaningfulChar
    return `${firstWord.slice(0, 1).toUpperCase()}${firstWord.slice(1, 2).toLowerCase()}`
  }

  const pinyin = PINYIN_SYLLABLE_OVERRIDES[firstMeaningfulChar]
  if (pinyin) {
    return `${pinyin.slice(0, 1).toUpperCase()}${pinyin.slice(1, 2)}`
  }

  const initial = resolveHanInitial(firstMeaningfulChar)
  if (!initial) {
    return null
  }

  return `${initial}${DEFAULT_SECOND_PINYIN_LETTER[initial] ?? 'a'}`
}
