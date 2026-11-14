export const RESUME_PDF_TEMPLATE_VERSION = 'resume-pdf-v1'

export interface ResumePdfBlock {
  kind: 'heading1' | 'heading2' | 'heading3' | 'paragraph' | 'bullet' | 'numbered' | 'divider' | 'blank'
  text: string
}

export interface ResumePdfModel {
  version: 'resume-pdf-model-v1'
  title: string
  disposition: 'application_ready' | 'draft_only'
  blocks: ResumePdfBlock[]
}

export function escapeResumeHtml(value: string) {
  return value.replace(/[&<>"']/gu, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]!))
}

/** Only plain text enters the fixed template; uploaded HTML, images and links never execute. */
export function resumePdfBlocks(markdown: string): ResumePdfBlock[] {
  return markdown.split(/\r?\n/u).map(line => {
    const heading = line.match(/^(#{1,3})\s+(.+)$/u)
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/u)
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/u)
    const kind: ResumePdfBlock['kind'] = heading ? `heading${heading[1]!.length}` as 'heading1' | 'heading2' | 'heading3'
      : bullet ? 'bullet' : numbered ? 'numbered' : /^\s*(?:-{3,}|\*{3,})\s*$/u.test(line) ? 'divider'
        : line.trim() ? 'paragraph' : 'blank'
    const raw = heading?.[2] ?? bullet?.[1] ?? numbered?.[1] ?? line
    const text = raw.replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1').replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
      .replace(/\*\*([^*]+)\*\*/gu, '$1').replace(/__([^_]+)__/gu, '$1').replace(/`([^`]+)`/gu, '$1')
      .replace(/\\([\\`*_{}\[\]<>])/gu, '$1').trim()
    return {kind, text}
  }).filter((block, index, blocks) => block.kind !== 'blank' || (index > 0 && blocks[index - 1]!.kind !== 'blank'))
}

export function renderResumeHtml(model: ResumePdfModel): string {
  const blocks = model.blocks.map(block => {
    const text = escapeResumeHtml(block.text)
    if (block.kind === 'blank') return ''
    if (block.kind === 'divider') return '<hr>'
    if (block.kind.startsWith('heading')) {
      const tag = `h${block.kind.slice(-1)}`
      return `<${tag}>${text}</${tag}>`
    }
    if (block.kind === 'bullet' || block.kind === 'numbered') return `<div class="item"><span class="marker">${block.kind === 'bullet' ? '•' : '·'}</span><p>${text}</p></div>`
    return `<p>${text}</p>`
  }).join('\n')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src 'self' data:"><title>${escapeResumeHtml(model.title)}</title><style>
    @page {size: A4; margin: 15mm 17mm 16mm;}
    * {box-sizing: border-box;} html {color: #111; background: white;}
    body {margin: 0; font-family: 'Noto Sans CJK SC', 'Noto Sans SC', 'Arial Unicode MS', 'PingFang SC', 'Microsoft YaHei', sans-serif; font-size: 10pt; line-height: 1.55; overflow-wrap: anywhere;}
    h1 {font-size: 21pt; line-height: 1.25; margin: 0 0 5mm; font-weight: 700;}
    h2 {font-size: 12pt; margin: 5mm 0 2mm; border-bottom: .3mm solid #222; padding-bottom: 1mm; break-after: avoid;}
    h3 {font-size: 10.5pt; margin: 3mm 0 1mm; break-after: avoid;}
    p {margin: 0 0 1.5mm; orphans: 2; widows: 2;}
    .item {display: flex; align-items: baseline; gap: 2mm; margin-bottom: 1.2mm; break-inside: avoid;}
    .item p {margin: 0; flex: 1; min-width: 0;} .marker {flex: 0 0 2mm;}
    .draft {font-size: 9pt; color: #555; margin: 0 0 3mm;}
    hr {border: 0; border-top: .2mm solid #aaa; margin: 3mm 0;}
  </style></head><body>${model.disposition === 'draft_only' ? '<p class="draft">待完善稿</p>' : ''}<main>${blocks}</main></body></html>`
}
