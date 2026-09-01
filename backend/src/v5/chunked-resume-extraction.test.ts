import { describe, expect, test } from 'bun:test'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import {
  DEFAULT_RESUME_EXTRACTION_CONCURRENCY,
  DEFAULT_RESUME_EXTRACTION_MAX_CHARACTERS,
  DEFAULT_RESUME_EXTRACTION_MAX_BLOCKS,
  DEFAULT_RESUME_EXTRACTION_MAX_ESTIMATED_OUTPUT_TOKENS,
  ResumeExtractionChunkCapacityError,
  splitResumeDocument,
} from '@/v5/chunked-resume-extraction'

function chunksFor(markdown: string, maxBlocks: number) {
  const document = canonicalizeSourceDocument(markdown, 'chunk-test').canonicalDocument
  return { document, chunks: splitResumeDocument(document, maxBlocks) }
}

describe('v5 resume extraction chunk boundaries', () => {
  test('uses a conservative extraction concurrency default', () => {
    expect(DEFAULT_RESUME_EXTRACTION_CONCURRENCY).toBe(2)
    expect(DEFAULT_RESUME_EXTRACTION_MAX_BLOCKS).toBe(24)
    expect(DEFAULT_RESUME_EXTRACTION_MAX_CHARACTERS).toBe(1_000)
    expect(DEFAULT_RESUME_EXTRACTION_MAX_ESTIMATED_OUTPUT_TOKENS).toBe(12_500)
  })

  test('avoids over-fragmenting a compact resume while preserving scope boundaries', () => {
    const scopes = Array.from({ length: 8 }, (_, index) => [
      `### Company ${index + 1}`,
      ...Array.from({ length: 19 }, (__, bulletIndex) => `- Result ${index + 1}.${bulletIndex + 1}`),
    ]).flat()
    const document = canonicalizeSourceDocument([
      '# Candidate',
      '## Work Experience',
      ...scopes,
    ].join('\n'), 'compact-long-resume').canonicalDocument

    const chunks = splitResumeDocument(document)

    expect(chunks).toHaveLength(8)
    expect(chunks.every(chunk => chunk.blocks.length <= DEFAULT_RESUME_EXTRACTION_MAX_BLOCKS)).toBe(true)
    expect(chunks.flatMap(chunk => chunk.blocks.map(block => block.sourceBlockId)))
      .toEqual(document.blocks.map(block => block.sourceBlockId))
  })

  test('keeps a detailed experience and all nested headings in one oversized chunk', () => {
    const { document, chunks } = chunksFor([
      '# 张三',
      '## 工作经历',
      '### 甲公司｜产品经理',
      '- 负责需求分析',
      '#### 关键成果',
      '- 交付项目 A',
      '- 推动项目上线',
      '### 乙公司｜产品助理',
      '- 支持用户调研',
      '## 专业技能',
      '- SQL',
    ].join('\n'), 3)

    expect(chunks.map(chunk => chunk.blocks.length)).toEqual([2, 5, 2, 2])
    const firstExperienceIds = document.blocks.slice(2, 7).map(block => block.sourceBlockId)
    expect(chunks.some(chunk => firstExperienceIds.every(id => chunk.blocks.some(block => block.sourceBlockId === id)))).toBe(true)
  })

  test('packs adjacent logical scopes without exceeding the target where possible', () => {
    const { chunks } = chunksFor([
      '# Candidate',
      '## Work Experience',
      '### Company A | Engineer',
      '- Built A',
      '### Company B | Engineer',
      '- Built B',
      '## Skills',
      '- TypeScript',
    ].join('\n'), 4)

    expect(chunks.map(chunk => chunk.blocks.map(block => block.text))).toEqual([
      ['# Candidate', '## Work Experience', '### Company A | Engineer', '- Built A'],
      ['### Company B | Engineer', '- Built B', '## Skills', '- TypeScript'],
    ])
  })

  test('treats an unheaded document as one unknown scope instead of hard-splitting it', () => {
    const { document, chunks } = chunksFor([
      '张三',
      '甲公司｜产品经理｜2022-至今',
      '负责产品规划',
      '交付三个版本',
      '技能：SQL',
    ].join('\n'), 2)

    expect(chunks).toHaveLength(1)
    expect(chunks[0].blocks).toEqual(document.blocks)
  })

  test('preserves source order and assigns every block to exactly one chunk', () => {
    const { document, chunks } = chunksFor([
      '# Candidate',
      '## Projects',
      '### Project A',
      '- Result A',
      '### Project B',
      '- Result B',
      '### Project C',
      '- Result C',
    ].join('\n'), 3)

    const chunkedIds = chunks.flatMap(chunk => chunk.blocks.map(block => block.sourceBlockId))
    expect(chunkedIds).toEqual(document.blocks.map(block => block.sourceBlockId))
    expect(new Set(chunkedIds).size).toBe(document.blocks.length)
  })

  test('rejects an invalid block target instead of entering a non-terminating split loop', () => {
    const document = canonicalizeSourceDocument('A\nB', 'invalid-limit').canonicalDocument
    expect(() => splitResumeDocument(document, 0)).toThrow(RangeError)
    expect(() => splitResumeDocument(document, 1.5)).toThrow(RangeError)
  })

  test('uses character capacity as a hard boundary while preserving every source block once', () => {
    const { document, chunks } = chunksFor([
      '# Candidate',
      '## Projects',
      '### Project A',
      `- ${'A'.repeat(320)}`,
      '### Project B',
      `- ${'B'.repeat(320)}`,
      '### Project C',
      `- ${'C'.repeat(320)}`,
    ].join('\n'), 24)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(chunk => chunk.blocks.reduce((sum, block) => sum + block.text.length, 0) <= 1_000)).toBe(true)
    expect(chunks.flatMap(chunk => chunk.blocks.map(block => block.sourceBlockId)))
      .toEqual(document.blocks.map(block => block.sourceBlockId))
  })

  test('fails closed when one indivisible scope exceeds hard output capacity', () => {
    const document = canonicalizeSourceDocument([
      '## Work Experience',
      '### One oversized role',
      `- ${'结果'.repeat(600)}`,
    ].join('\n'), 'oversized-scope').canonicalDocument

    expect(() => splitResumeDocument(document)).toThrow(ResumeExtractionChunkCapacityError)
  })
})
