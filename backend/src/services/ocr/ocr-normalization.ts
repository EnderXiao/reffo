import {createDigest} from '@/harness/run-context'
import {decodeHtmlEntities} from '@/services/text-normalizer'

export interface OcrTextEdit {start: number; end: number; outputStart: number; before: string; after: string; reason: string; confidence: 'deterministic' | 'high'}
export interface OcrNormalizationDiagnostic {
  version: 'ocr-normalization-v1'
  rawDigest: string
  normalizedDigest: string
  rawLength: number
  normalizedLength: number
  stages: Array<{stage: string; inputDigest: string; outputDigest: string; edits: OcrTextEdit[]}>
  ambiguities: Array<{start: number; end: number; token: string; candidates: string[]; resolution: 'unresolved'}>
}

/** Private parse result carries replayable edits; routine diagnostics persist only hashes and counts. */
export function normalizeOcrText(raw: string): {text: string; diagnostic: OcrNormalizationDiagnostic; warnings: string[]} {
  let text = raw
  const stages: OcrNormalizationDiagnostic['stages'] = []
  const rewrite = (stage: string, pattern: RegExp, replace: (match: string) => string, reason: string, confidence: OcrTextEdit['confidence'] = 'deterministic') => {
    const input = text, edits: OcrTextEdit[] = []
    let delta = 0
    text = input.replace(pattern, (match: string, ...args: unknown[]) => {
      const start = args[args.length - 2] as number
      const after = replace(match)
      if (match !== after) {edits.push({start, end: start + match.length, outputStart: start + delta, before: match, after, reason, confidence}); delta += after.length - match.length}
      return after
    })
    if (edits.length) stages.push({stage, inputDigest: createDigest(input), outputDigest: createDigest(text), edits})
  }
  rewrite('html_entities', /&(?:#x?[0-9a-f]+|[a-z]+);/gi, decodeHtmlEntities, 'HTML_ENTITY_DECODE')
  rewrite('line_endings', /\r\n?/g, () => '\n', 'LINE_ENDING_NORMALIZED')
  rewrite('html_comments', /<!--[\s\S]*?-->/g, () => '', 'NONVISIBLE_HTML_REMOVED')
  rewrite('html_breaks', /<br\s*\/?>/gi, () => '\n', 'HTML_LINE_BREAK')
  const blocks = 'address|article|aside|blockquote|center|div|dl|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul'
  rewrite('html_block_closings', new RegExp(`</(?:${blocks})\\s*>`, 'gi'), () => '\n', 'HTML_BLOCK_LINE_BREAK')
  rewrite('html_tags', /<\/?[^>\n]+>/g, () => '', 'HTML_MARKUP_REMOVED')
  rewrite('trailing_line_space', /[ \t]+\n/g, () => '\n', 'LINE_SPACE_REMOVED')
  rewrite('leading_line_space', /\n[ \t]+/g, () => '\n', 'LINE_SPACE_REMOVED')
  rewrite('blank_lines', /\n{3,}/g, () => '\n\n', 'EXCESS_BLANK_LINE_REMOVED')
  rewrite('outer_space', /^\s+|\s+$/g, () => '', 'OUTER_SPACE_REMOVED')
  rewrite('contextual_ai_confusable', /\bAl(?=[ \t]*(?:产品|工具|应用|模型|能力|平台|技术|工作流|智能体))/gu,
    () => 'AI', 'OCR_CONFUSABLE_AI_CONTEXT', 'high')
  const ambiguities = [...text.matchAll(/\b(?:Al|A1)\b/gu)].map(match => ({start: match.index!, end: match.index! + match[0].length,
    token: match[0], candidates: [match[0], 'AI'], resolution: 'unresolved' as const}))
  return {text, diagnostic: {version: 'ocr-normalization-v1', rawDigest: createDigest(raw), normalizedDigest: createDigest(text), rawLength: raw.length,
    normalizedLength: text.length, stages, ambiguities}, warnings: ambiguities.length ? ['存在Al/A1等易混淆词，已保留原词，未自动升级含义。'] : []}
}

export function normalizationSummary(value: OcrNormalizationDiagnostic) {
  return {version: value.version, rawDigest: value.rawDigest, normalizedDigest: value.normalizedDigest,
    rawLength: value.rawLength, normalizedLength: value.normalizedLength, changeCount: value.stages.reduce((count, stage) => count + stage.edits.length, 0),
    stageCounts: value.stages.map(stage => ({stage: stage.stage, count: stage.edits.length})), ambiguousCount: value.ambiguities.length}
}

export function recordOcrTextProjection(diagnostic: OcrNormalizationDiagnostic, before: string, after: string): OcrNormalizationDiagnostic {
  if (before === after) return diagnostic
  return {...diagnostic, normalizedDigest: createDigest(after), normalizedLength: after.length, stages: [...diagnostic.stages,
    {stage: 'structured_jd_projection', inputDigest: createDigest(before), outputDigest: createDigest(after),
      edits: [{start: 0, end: before.length, outputStart: 0, before, after, reason: 'STRUCTURED_JD_TEXT_FIELD_SELECTED', confidence: 'deterministic'}]}]}
}
