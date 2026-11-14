import {describe, expect, test} from 'bun:test'
import {createDigest} from '@/harness/run-context'
import {normalizeMarkdownText} from '@/services/text-normalizer'
import {normalizeOcrText, normalizationSummary, recordOcrTextProjection} from './ocr-normalization'

describe('auditable OCR normalization', () => {
  test('records replayable per-stage raw to normalized edits without losing unmodified text', () => {
    const source = '  <div>岗位&nbsp;职责</div>\r\n<p>6、负责需求分析</p>\n\n\n7、推动验收  '
    const result = normalizeOcrText(source)
    let replay = source
    for (const stage of result.diagnostic.stages) {
      expect(createDigest(replay)).toBe(stage.inputDigest)
      for (const edit of [...stage.edits].reverse()) {
        expect(replay.slice(edit.start, edit.end)).toBe(edit.before)
        replay = replay.slice(0, edit.start) + edit.after + replay.slice(edit.end)
      }
      expect(createDigest(replay)).toBe(stage.outputDigest)
    }
    expect(replay).toBe(result.text)
    expect(result.text).toBe(normalizeMarkdownText(source))
    expect(result.text).toContain('6、负责需求分析')
    expect(result.text).toContain('7、推动验收')
  })
  test('contextual AI correction preserves its source and unresolved ambiguous tokens remain unchanged', () => {
    const result = normalizeOcrText('Al产品经理，熟悉Al工具；Al / A1平台代号')
    expect(result.text).toBe('AI产品经理，熟悉AI工具；Al / A1平台代号')
    const corrections = result.diagnostic.stages.find(stage => stage.stage === 'contextual_ai_confusable')!.edits
    expect(corrections.map(edit => ({before: edit.before, after: edit.after, confidence: edit.confidence}))).toEqual([
      {before: 'Al', after: 'AI', confidence: 'high'}, {before: 'Al', after: 'AI', confidence: 'high'}])
    expect(result.diagnostic.ambiguities.map(item => item.token)).toEqual(['Al', 'A1'])
    const summary = JSON.stringify(normalizationSummary(result.diagnostic))
    expect(summary).not.toContain('产品经理')
    expect(summary).not.toContain('before')
  })
  test('structured JSON text selection remains an explicit auditable projection', () => {
    const raw = '{"jdText":"岗位职责：负责产品规划"}'
    const normalized = normalizeOcrText(raw)
    const diagnostic = recordOcrTextProjection(normalized.diagnostic, normalized.text, '岗位职责：负责产品规划')
    expect(diagnostic.normalizedDigest).toBe(createDigest('岗位职责：负责产品规划'))
    expect(diagnostic.stages.at(-1)?.edits[0]).toMatchObject({before: raw, after: '岗位职责：负责产品规划', reason: 'STRUCTURED_JD_TEXT_FIELD_SELECTED'})
  })
})
