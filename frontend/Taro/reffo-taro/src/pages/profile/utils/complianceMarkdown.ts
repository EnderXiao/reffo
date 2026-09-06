export type ComplianceInline =
  | {type: 'text'; text: string}
  | {type: 'strong'; text: string}
  | {type: 'code'; text: string}
  | {type: 'link'; text: string; href: string}

type TextBlockType = 'h1' | 'h2' | 'h3' | 'p' | 'quote'

export type ComplianceBlock =
  | {type: TextBlockType; content: ComplianceInline[]}
  | {type: 'li'; marker: string; content: ComplianceInline[]}
  | {type: 'table'; headers: ComplianceInline[][]; rows: ComplianceInline[][][]}

const inlinePattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g

export function parseComplianceInline(value: string): ComplianceInline[] {
  const result: ComplianceInline[] = []
  let cursor = 0

  for (const match of value.matchAll(inlinePattern)) {
    const index = match.index ?? 0
    if (index > cursor) result.push({type: 'text', text: value.slice(cursor, index)})

    const token = match[0]
    if (token.startsWith('**')) {
      result.push({type: 'strong', text: token.slice(2, -2)})
    } else if (token.startsWith('`')) {
      result.push({type: 'code', text: token.slice(1, -1)})
    } else {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token)
      if (link) result.push({type: 'link', text: link[1], href: link[2]})
    }
    cursor = index + token.length
  }

  if (cursor < value.length) result.push({type: 'text', text: value.slice(cursor)})
  return result.length > 0 ? result : [{type: 'text', text: value}]
}

function splitTableRow(value: string): string[] {
  const trimmed = value.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cell = ''
  let inCode = false

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index]
    if (character === '`') inCode = !inCode
    if (character === '\\' && trimmed[index + 1] === '|') {
      cell += '|'
      index += 1
    } else if (character === '|' && !inCode) {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += character
    }
  }

  cells.push(cell.trim())
  return cells
}

function isTableDivider(value: string): boolean {
  const cells = splitTableRow(value)
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell))
}

export function parseComplianceMarkdown(markdown: string): ComplianceBlock[] {
  const lines = markdown.split(/\r?\n/)
  const blocks: ComplianceBlock[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const value = lines[index].trim()
    if (!value) continue

    if (value.includes('|') && lines[index + 1] && isTableDivider(lines[index + 1])) {
      const headers = splitTableRow(value).map(parseComplianceInline)
      const rows: ComplianceInline[][][] = []
      index += 2
      while (index < lines.length && lines[index].trim().includes('|')) {
        rows.push(splitTableRow(lines[index]).map(parseComplianceInline))
        index += 1
      }
      index -= 1
      blocks.push({type: 'table', headers, rows})
      continue
    }

    if (value.startsWith('### ')) {
      blocks.push({type: 'h3', content: parseComplianceInline(value.slice(4))})
    } else if (value.startsWith('## ')) {
      blocks.push({type: 'h2', content: parseComplianceInline(value.slice(3))})
    } else if (value.startsWith('# ')) {
      blocks.push({type: 'h1', content: parseComplianceInline(value.slice(2))})
    } else if (value.startsWith('> ')) {
      blocks.push({type: 'quote', content: parseComplianceInline(value.slice(2))})
    } else if (/^[-*] /.test(value)) {
      blocks.push({type: 'li', marker: '•', content: parseComplianceInline(value.slice(2))})
    } else {
      const orderedItem = /^(\d+)\.\s+(.+)$/.exec(value)
      if (orderedItem) {
        blocks.push({type: 'li', marker: `${orderedItem[1]}.`, content: parseComplianceInline(orderedItem[2])})
      } else {
        blocks.push({type: 'p', content: parseComplianceInline(value.replace(/\s{2}$/, ''))})
      }
    }
  }

  return blocks
}
