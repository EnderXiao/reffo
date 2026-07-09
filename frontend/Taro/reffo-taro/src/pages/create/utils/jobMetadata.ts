function normalizeOcrLine(line: string) {
  return line
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[\-*•]\s*/, '')
    .trim()
}

export function normalizeCompanyNameCandidate(value: string) {
  return normalizeOcrLine(value)
    .replace(/^(?:公司名称|公司|企业|招聘方)[:：]\s*/, '')
    .replace(/(?:正在招聘|招聘中|热招中|诚聘|直聘|招聘|招募).*$/i, '')
    .replace(/[，,。；;：:\s]+$/g, '')
    .replace(/tv/ig, 'TV')
    .replace(/([\u3400-\u9fff])([A-Z]{2,})\b/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizePositionNameCandidate(value: string) {
  return normalizeOcrLine(value)
    .replace(/^(?:岗位名称|职位名称|招聘岗位|岗位|职位)[:：]\s*/, '')
    .replace(/[，,。；;：:\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isLikelyMetadataLine(line: string) {
  return Boolean(line) && !/[\/|｜].*(?:K|k|年|本科|硕士|博士|经验|薪)/.test(line)
}

function isGenericJobSectionTitle(line: string) {
  return /^(?:职位详情|岗位详情|职位描述|岗位描述|职位职责|岗位职责|工作职责|任职要求|职位要求|岗位要求|公司介绍)$/i.test(line)
}

function isRecruitingHeadline(line: string) {
  return /(?:正在招聘|招聘中|热招中|诚聘|直聘|招募)/i.test(line)
}

function isLikelyPositionNameCandidate(line: string) {
  return (
    isLikelyMetadataLine(line) &&
    !isGenericJobSectionTitle(line) &&
    !isRecruitingHeadline(line)
  )
}

export function resolvePositionNameCandidate(...candidates: string[]) {
  return candidates
    .map(normalizePositionNameCandidate)
    .find(isLikelyPositionNameCandidate) || ''
}

export function extractJobMetadataFromOcrText(text: string) {
  const rawLines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  const normalizedLines = rawLines.map(normalizeOcrLine)
  const companyLineIndex = rawLines.findIndex(line =>
    /(?:正在招聘|招聘中|热招中|诚聘|直聘|招聘|招募)/i.test(line),
  )
  const labelledCompany = normalizedLines
    .map(line => line.match(/^(?:公司名称|公司|企业|招聘方)[:：]\s*(.+)$/)?.[1] ?? '')
    .find(Boolean)
  const recruitingCompany = companyLineIndex >= 0
    ? normalizeCompanyNameCandidate(rawLines[companyLineIndex])
    : ''
  const firstPlainCompany = normalizedLines.find((line, index) => {
    const rawLine = rawLines[index] ?? ''

    return (
      index < 2 &&
      isLikelyMetadataLine(line) &&
      !/^#{1,6}\s*\S+/.test(rawLine) &&
      !isGenericJobSectionTitle(line) &&
      !/(?:岗位|职位|职责|要求|详情|薪资|经验|本科|硕士|博士)/.test(line)
    )
  })
  const headingPosition = rawLines
    .filter(line => /^#{1,3}\s*\S+/.test(line))
    .map(normalizePositionNameCandidate)
    .find(isLikelyPositionNameCandidate)
  const labelledPosition = normalizedLines
    .map(line => line.match(/^(?:岗位名称|职位名称|招聘岗位|岗位|职位)[:：]\s*(.+)$/)?.[1] ?? '')
    .map(normalizePositionNameCandidate)
    .find(isLikelyPositionNameCandidate)
  const nextLinePosition = companyLineIndex >= 0
    ? normalizedLines
        .slice(companyLineIndex + 1, companyLineIndex + 4)
        .map(normalizePositionNameCandidate)
        .find(isLikelyPositionNameCandidate)
    : ''

  return {
    companyName: normalizeCompanyNameCandidate(labelledCompany || recruitingCompany || firstPlainCompany || ''),
    positionName: resolvePositionNameCandidate(labelledPosition || '', headingPosition || '', nextLinePosition || ''),
  }
}
