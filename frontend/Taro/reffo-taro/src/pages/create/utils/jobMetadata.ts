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

export function normalizeLocationCandidate(value: string) {
  return normalizeOcrLine(value)
    .replace(/^(?:工作地点|工作地|办公地点|办公地|地点|城市|Base地|base地|Base|base)[:：]\s*/i, '')
    .replace(/\s*(?:可远程|远程办公|可居家).*$/i, '')
    .replace(/[，,。；;：:\s]+$/g, '')
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

function isLikelyCompanyName(line: string) {
  return /(?:公司|集团|科技|网络|智能|股份|传媒|文化|信息|实业)$/i.test(line)
}

function isLikelyPositionNameCandidate(line: string) {
  return (
    isLikelyMetadataLine(line) &&
    !isGenericJobSectionTitle(line) &&
    !isRecruitingHeadline(line)
  )
}

function isLikelyLocationCandidate(line: string) {
  return (
    Boolean(line) &&
    line.length <= 16 &&
    /[\u3400-\u9fff]/.test(line) &&
    !/(?:岗位|职位|职责|要求|详情|薪资|经验|本科|硕士|博士|招聘|公司)/.test(line) &&
    !isRecruitingHeadline(line) &&
    !isLikelyCompanyName(line)
  )
}

export function resolvePositionNameCandidate(...candidates: string[]) {
  return candidates
    .map(normalizePositionNameCandidate)
    .find(isLikelyPositionNameCandidate) || ''
}

export function resolveBaseLocationCandidate(
  candidates: string[],
  excludedValues: string[] = [],
) {
  const excludedSet = new Set(
    excludedValues
      .map(value => value.trim())
      .filter(Boolean),
  )

  return candidates
    .map(normalizeLocationCandidate)
    .find(candidate =>
      isLikelyLocationCandidate(candidate) && !excludedSet.has(candidate),
    ) || ''
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
  const labelledLocation = normalizedLines
    .map(line => line.match(/^(?:工作地点|工作地|办公地点|办公地|地点|城市|Base地|base地|Base|base)[:：]\s*(.+)$/i)?.[1] ?? '')
    .map(normalizeLocationCandidate)
    .find(isLikelyLocationCandidate)
  const slashLocation = normalizedLines
    .map((line, index) => {
      const rawLine = rawLines[index] ?? ''
      return /[\/|｜]/.test(rawLine)
        ? normalizeLocationCandidate(line.split(/[\/|｜]/)[0] ?? '')
        : ''
    })
    .find((line, index) => index < 6 && isLikelyLocationCandidate(line))

  return {
    companyName: normalizeCompanyNameCandidate(labelledCompany || recruitingCompany || firstPlainCompany || ''),
    positionName: resolvePositionNameCandidate(labelledPosition || '', headingPosition || '', nextLinePosition || ''),
    baseLocation: resolveBaseLocationCandidate([labelledLocation || '', slashLocation || '']),
  }
}
