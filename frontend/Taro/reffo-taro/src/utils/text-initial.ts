const HAN_INITIAL_GROUPS: Record<string, string> = {
  A: '阿啊安爱奥澳艾',
  B: '百北贝哔博宝包巴拜比币碧波本佰白班帮必边保',
  C: '菜曹茶车成橙程长创春传超潮城驰赤楚川灿餐仓策彩',
  D: '大滴得德东多达当豆斗鼎点电第度敦抖懂朵地叮',
  E: '饿二鄂恩尔',
  F: '飞分方丰富复福蜂凡泛房风付傅费丰饭粉',
  G: '高广国谷瓜光工公果格购观冠贵硅跟赶瓜管',
  H: '华海好哈盒和虎慧汇花火红鸿恒合湖汉航欢惠宏',
  J: '京金极吉今鲸聚嘉佳简基机巨即君节桔疆加九酒',
  K: '快科酷可开看昆康口旷凯客库跨',
  L: '联猎拉蓝理领零流陆绿乐朗雷鹿龙良罗荔力里链',
  M: '美芒马蚂米明名磨墨满萌梦木麦妙觅慢猫',
  N: '农哪拿牛纳南宁诺暖能你鸟奈内年',
  O: '欧偶',
  P: '拼苹平品派拍泡普票胖浦跑鹏朋皮',
  Q: '七企奇趣青清汽启千前轻全秋泉起齐钱强桥求',
  R: '瑞融人热荣软如润燃日仁锐',
  S: '深顺闪商上神搜水数十石识三森松杉声生盛省苏速思四',
  T: '腾头同途淘天太团特图推土汤糖唐铁兔',
  W: '微网万我完唯沃蔚威文无五外物维旺王未屋玩',
  X: '小携新星喜兴讯西希夏先鲜香享心行学想象闲向信',
  Y: '有优云一易宜银英央雅羊药医游悦圆猿元鱼宇远阅艺盈亿氧',
  Z: '字知中智自猪转招众真张掌作在最左浙站租总钻',
}

const HAN_INITIALS = new Map<string, string>(
  Object.entries(HAN_INITIAL_GROUPS).flatMap(([initial, chars]) =>
    Array.from(chars).map(char => [char, initial] as const),
  ),
)

function isLatinLetter(char: string) {
  return /^[A-Za-z]$/.test(char)
}

function isHanChar(char: string) {
  return /[\u3400-\u9fff]/.test(char)
}

function isMeaningfulInitialChar(char: string) {
  return isLatinLetter(char) || isHanChar(char)
}

export function resolveTextInitial(value: string): string | null {
  const firstMeaningfulChar = Array.from(value.trim()).find(isMeaningfulInitialChar)

  if (!firstMeaningfulChar) {
    return null
  }

  if (isLatinLetter(firstMeaningfulChar)) {
    return firstMeaningfulChar.toUpperCase()
  }

  return HAN_INITIALS.get(firstMeaningfulChar) ?? null
}
