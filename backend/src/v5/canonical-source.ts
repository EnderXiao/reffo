import { createHash, randomUUID } from 'node:crypto'
import type { CanonicalSourceDocument, SourceBlock } from '@/v5/types'
import { isLexicallyProvenSourceContinuation } from '@/v5/composition/source-continuation'
import { isPlainSourceContinuationBlock, isSourceLayoutWhitespace, sourceLineBlockBinding } from '@/v5/composition/source-continuation-proof'

const ZERO_WIDTH_OR_BIDI = /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u
const HIDDEN_MARKUP = /<!--|-->|<[^>]+(?:hidden|display\s*:\s*none)[^>]*>/i
const INJECTION_LANGUAGE = /(?:ignore|忽略).{0,24}(?:previous|above|system|instructions?|此前|以上|系统|指令)|(?:system\s*prompt|开发者消息|泄漏.{0,8}提示词|扮演.{0,12}(?:角色|agent))/i
const TAG_BREAKOUT = /<\/(?:source_resume|job_description|untrusted_input_json|system|developer)>|```(?:system|developer)/i

export interface CanonicalizationResult {
  rawSha256: string
  canonicalDocument: CanonicalSourceDocument
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function detectPrimaryLanguage(value: string) {
  const cjkCount = (value.match(/[\u3400-\u9FFF]/gu) ?? []).length
  const latinCount = (value.match(/[A-Za-z]/g) ?? []).length

  if (cjkCount === 0 && latinCount === 0) return 'unknown'
  if (cjkCount > 0 && latinCount > cjkCount * 0.35) return 'zh-en-mixed'
  return cjkCount >= latinCount * 0.2 ? 'zh-CN' : 'en'
}

function detectRiskFlags(text: string) {
  const flags: string[] = []
  if (ZERO_WIDTH_OR_BIDI.test(text)) flags.push('unicode_control_character')
  if (HIDDEN_MARKUP.test(text)) flags.push('hidden_markup')
  if (INJECTION_LANGUAGE.test(text)) flags.push('prompt_injection_like_text')
  if (TAG_BREAKOUT.test(text)) flags.push('delimiter_breakout_attempt')
  return flags
}

function sectionHintFromHeading(text: string) {
  const heading = text.match(/^#{1,6}\s+(.+)$/)
  return heading?.[1]?.trim() || null
}

function splitCanonicalBlocks(canonicalText: string): SourceBlock[] {
  const blocks: SourceBlock[] = []
  let currentSection: string | null = null
  let offset = 0

  for (const rawLine of canonicalText.split('\n')) {
    const leadingWhitespace = rawLine.length - rawLine.trimStart().length
    const text = rawLine.trim()
    if (text) {
      const sectionHeading = sectionHintFromHeading(text)
      if (sectionHeading) currentSection = sectionHeading
      const canonicalStart = offset + leadingWhitespace
      const canonicalEnd = canonicalStart + text.length
      blocks.push({
        sourceBlockId: `B${String(blocks.length + 1).padStart(4, '0')}`,
        canonicalStart,
        canonicalEnd,
        text,
        sectionHint: sectionHeading ?? currentSection,
        inputRiskFlags: detectRiskFlags(text),
      })
    }
    offset += rawLine.length + 1
  }

  return blocks
}

export function canonicalizeSourceDocument(rawInput: string, documentId: string = randomUUID()): CanonicalizationResult {
  const canonicalText = rawInput.replace(/\r\n?/g, '\n').normalize('NFC')
  const canonicalDocument: CanonicalSourceDocument = {
    documentId,
    sha256: sha256(canonicalText),
    primaryLanguage: detectPrimaryLanguage(canonicalText),
    canonicalLength: canonicalText.length,
    blocks: splitCanonicalBlocks(canonicalText),
  }
  const sourceLineContinuations: NonNullable<CanonicalSourceDocument['sourceLineContinuations']> = []
  for (let index = 1; index < canonicalDocument.blocks.length; index += 1) {
    const previous = canonicalDocument.blocks[index - 1]
    const current = canonicalDocument.blocks[index]
    const separator = canonicalText.slice(previous.canonicalEnd, current.canonicalStart)
    if (!isSourceLayoutWhitespace(separator)
      || previous.inputRiskFlags.length || current.inputRiskFlags.length
      || !isPlainSourceContinuationBlock(previous.text) || !isPlainSourceContinuationBlock(current.text)
      || !isLexicallyProvenSourceContinuation(previous.text, current.text)) continue
    sourceLineContinuations.push({ previousBlockId: previous.sourceBlockId, currentBlockId: current.sourceBlockId,
      separator, binding: sourceLineBlockBinding(canonicalDocument.sha256, previous, current, separator) })
  }
  if (sourceLineContinuations.length) canonicalDocument.sourceLineContinuations = sourceLineContinuations

  return {
    rawSha256: sha256(rawInput),
    canonicalDocument,
  }
}

export function rebuildCanonicalText(document: CanonicalSourceDocument) {
  const buffer = Array.from({ length: document.canonicalLength }, () => ' ')
  for (const block of document.blocks) {
    for (let index = 0; index < block.text.length; index += 1) {
      buffer[block.canonicalStart + index] = block.text[index]
    }
  }
  return buffer.join('')
}
