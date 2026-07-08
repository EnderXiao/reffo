/**
 * 历史记录辅助函数
 *
 * 提供从 ProcessResult 创建 ResumeHistory 的工具函数
 */

import type {ProcessResult, ResumeHistory} from '@/types';

/**
 * 从 ProcessResult 创建 ResumeHistory
 *
 * @param result API 返回的处理结果
 * @param resumeContent 原始简历内容
 * @param jdContent JD 内容
 * @returns 历史记录对象
 */
export function createHistoryFromResult(
  result: ProcessResult,
  resumeContent: string,
  jdContent: string,
): ResumeHistory {
  // 提取岗位名称（从 JD 中提取，简化处理）
  const position = extractPosition(jdContent);

  // 提取公司名称（从 JD 中提取，简化处理）
  const company = extractCompany(jdContent);

  // 提取姓名
  const name = result.analysis.structured_resume.personal_info.name || '未知';

  // 提取标签（取前 3 个匹配的技能）
  const tags = result.matching.skill_match.matched_skills.slice(0, 3);

  // 生成随机卡片颜色
  const cardColor = generateCardColor();

  return {
    id: '',
    position,
    company,
    name,
    createdAt: new Date().toISOString(),
    qualityScore: result.analysis.quality_score,
    matchScore: result.matching.match_score,
    tags,
    resumeContent,
    jdContent,
    optimizedContent: result.optimized.optimized_resume,
    optimizationSuggestions: result.matching.optimization_suggestions,
    changesSummary: result.optimized.changes_summary,
    processResult: result,
    resultContext: {
      company,
      position,
      resumeContent,
      jdContent,
    },
    progress: {
      analysis: 'done',
      matching: 'done',
      optimized: 'done',
      interview: 'done',
    },
    cardColor,
  };
}

/**
 * 从 JD 文本中提取岗位名称
 *
 * @param jdContent JD 内容
 * @returns 岗位名称
 */
function extractPosition(jdContent: string): string {
  // 尝试匹配常见的岗位名称模式
  const patterns = [
    /岗位[名称]*[：:]\s*(.+?)[\n\r]/,
    /职位[名称]*[：:]\s*(.+?)[\n\r]/,
    /招聘[：:]\s*(.+?)[\n\r]/,
  ];

  for (const pattern of patterns) {
    const match = jdContent.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  // 如果没有匹配到，返回默认值
  return '未知岗位';
}

/**
 * 从 JD 文本中提取公司名称
 *
 * @param jdContent JD 内容
 * @returns 公司名称
 */
function extractCompany(jdContent: string): string {
  // 尝试匹配常见的公司名称模式
  const patterns = [
    /公司[名称]*[：:]\s*(.+?)[\n\r]/,
    /企业[名称]*[：:]\s*(.+?)[\n\r]/,
  ];

  for (const pattern of patterns) {
    const match = jdContent.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  // 如果没有匹配到，返回默认值
  return '未知公司';
}

/**
 * 生成随机卡片颜色
 *
 * @returns 颜色值
 */
function generateCardColor(): string {
  const hue = Math.floor(Math.random() * 360)
  const isDark = Math.random() < 0.24
  const saturation = isDark
    ? 18 + Math.floor(Math.random() * 18)
    : 68 + Math.floor(Math.random() * 16)
  const lightness = isDark
    ? 16 + Math.floor(Math.random() * 8)
    : 48 + Math.floor(Math.random() * 8)

  return hslToHex(hue, saturation, lightness)
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const normalizedHue = ((hue % 360) + 360) % 360 / 360
  const normalizedSaturation = saturation / 100
  const normalizedLightness = lightness / 100

  if (normalizedSaturation === 0) {
    const channel = Math.round(normalizedLightness * 255)
    return `#${toHex(channel)}${toHex(channel)}${toHex(channel)}`
  }

  const temp2 =
    normalizedLightness < 0.5
      ? normalizedLightness * (1 + normalizedSaturation)
      : normalizedLightness + normalizedSaturation - (normalizedLightness * normalizedSaturation)
  const temp1 = (2 * normalizedLightness) - temp2

  const red = hueToChannel(temp1, temp2, normalizedHue + (1 / 3))
  const green = hueToChannel(temp1, temp2, normalizedHue)
  const blue = hueToChannel(temp1, temp2, normalizedHue - (1 / 3))

  return `#${toHex(red * 255)}${toHex(green * 255)}${toHex(blue * 255)}`
}

function hueToChannel(temp1: number, temp2: number, hue: number): number {
  let resolvedHue = hue

  if (resolvedHue < 0) {
    resolvedHue += 1
  }

  if (resolvedHue > 1) {
    resolvedHue -= 1
  }

  if ((6 * resolvedHue) < 1) {
    return temp1 + ((temp2 - temp1) * 6 * resolvedHue)
  }

  if ((2 * resolvedHue) < 1) {
    return temp2
  }

  if ((3 * resolvedHue) < 2) {
    return temp1 + ((temp2 - temp1) * ((2 / 3) - resolvedHue) * 6)
  }

  return temp1
}

function toHex(value: number): string {
  return Math.round(value).toString(16).padStart(2, '0').toUpperCase()
}
