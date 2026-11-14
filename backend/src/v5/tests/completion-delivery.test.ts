import {expect, test} from 'bun:test'
import {selectCompletionGaps, type GapSelectionCandidate} from '@/v5/writing/gap-selection'
import {buildCompletionDocument} from '@/v5/writing/completion-document'
import {deliveredResumeMarkdown} from '@/v5/delivery-markdown'
import {prepareResumeExport, serializeDraft, serializeWithoutAllGapClauses, applyCompletionCommand} from '@/shared/resume-completion'
import type {EntrySegment} from '@/v5/writing/entry-skeleton'
import {createV5ResultFixture} from './fixtures'

function candidate(entryId: string, element: GapSelectionCandidate['element'], order: number, taskPriority = 0): GapSelectionCandidate {
  return {entryId, scopeId: entryId, element, order, taskPriority, path: `${entryId}.p${order}`, index: 1,
    purpose: element === 'responsibility' ? 'clarify_contribution' : element === 'result' ? 'identify_deliverable'
      : element === 'project' ? 'identify_object' : 'explain_key_action'}
}

test('document selection admits every useful gap without a count quota', () => {
  expect(selectCompletionGaps([])).toEqual([])
  const candidates = [candidate('a', 'responsibility', 0), candidate('a', 'problem', 1),
    candidate('b', 'problem', 2), candidate('c', 'solution', 3), candidate('d', 'result', 4)]
  const selected = selectCompletionGaps(candidates)
  expect(selected.filter(item => item.disposition === 'selected').map(item => item.entryId)).toEqual(['a', 'a', 'b', 'c', 'd'])
  expect(selectCompletionGaps([...candidates].reverse())).toEqual(selected)
})

test('duplicate scope facts get one gap; different projects may independently need the same element', () => {
  const first = candidate('first', 'problem', 0), duplicate = {...candidate('second', 'problem', 1), scopeId: 'first'}
  const selected = selectCompletionGaps([first, duplicate, candidate('third', 'problem', 2)])
  expect(selected.find(item => item.entryId === 'second')?.disposition).toBe('omitted_duplicate')
  expect(selected.filter(item => item.disposition === 'selected')).toHaveLength(2)
})

test('a sourced child project owns its finding blank while independent child studies stay separate', () => {
  const finding = (entryId: string, order: number, parentScopeId?: string): GapSelectionCandidate => ({...candidate(entryId, 'result', order),
    detailId: `${entryId}:finding`, detailKind: 'research_finding', subject: entryId, anchorEvidenceIds: [`${entryId}:evidence`], ...(parentScopeId ? {parentScopeId} : {})})
  const selected = selectCompletionGaps([finding('job', 0), finding('project-a', 1, 'job'), finding('project-b', 2, 'job'), finding('independent-job', 3)])
  expect(selected.find(item => item.entryId === 'job')?.disposition).toBe('omitted_duplicate')
  expect(selected.filter(item => item.disposition === 'selected').map(item => item.entryId)).toEqual(['project-a', 'project-b', 'independent-job'])
  expect(selectCompletionGaps([finding('job', 0)])[0]?.disposition).toBe('selected')
})

function duplicateParagraphDocument() {
  const text = '负责问卷与访谈，形成研究材料。'
  const segments: EntrySegment[] = [{kind: 'fact', text: '负责问卷与访谈', evidenceIds: ['e1']},
    {kind: 'optional_gap_clause', template: 'research_problem', candidates: []},
    {kind: 'fact', text: '，形成研究材料。', evidenceIds: ['e1']}]
  const artifactMarkdown = `# 示例\n\n- ${text}\n- ${text}`
  return {artifactMarkdown, document: buildCompletionDocument({documentId: 'generation:stable', artifactMarkdown,
    renderedBlocks: [{raw: '# 示例'}, {raw: ''}, {raw: `- ${text}`, outputPath: 'first'}, {raw: `- ${text}`, outputPath: 'second'}],
    finalParagraphs: new Map([['second', {segments}]]), enabledGaps: new Map([['second', new Set([1])]])})}
}

test('renderer identity locates only the intended duplicate paragraph and exports an unchanged complete fact projection', () => {
  const {document, artifactMarkdown} = duplicateParagraphDocument()
  expect(document.documentId).toBe('generation:stable')
  expect(document.revision).toBe(0)
  expect(serializeDraft(document).split('\n')[2]).not.toContain('待完善')
  expect(serializeDraft(document).split('\n')[3]).toContain('待完善：填一项实际研究过的使用问题')
  expect(serializeWithoutAllGapClauses(document)).toBe(artifactMarkdown)
  const before = JSON.stringify(document)
  expect(prepareResumeExport(document)).toEqual({ok: true, markdown: artifactMarkdown, omittedCount: 1})
  expect(JSON.stringify(document)).toBe(before)
})

test('a generated gap can be filled without modifying its identical neighboring paragraph', () => {
  const {document} = duplicateParagraphDocument()
  const gap = document.blocks[3].segments.find(segment => segment.kind === 'optional_gap_clause')!
  if (gap.kind !== 'optional_gap_clause') throw new Error('fixture')
  const updated = applyCompletionCommand(document, {type: 'fill', documentId: document.documentId,
    baseRevision: 0, gapId: gap.gapId, value: '测试用研究问题'})
  expect(updated.ok).toBe(true)
  if (!updated.ok) return
  expect(serializeDraft(updated.document).split('\n')[2]).toBe(serializeDraft(document).split('\n')[2])
  expect(prepareResumeExport(updated.document)).toMatchObject({ok: true, omittedCount: 0})
  expect(serializeDraft(updated.document)).toContain('围绕测试用研究问题这一研究问题')
})

test('public delivery rejects a stale sidecar instead of silently returning old Markdown', () => {
  const {document} = duplicateParagraphDocument(), result = createV5ResultFixture()
  result.completionDocument = document
  result.deliveryMarkdown = serializeDraft(document)
  expect(deliveredResumeMarkdown(result)).toBe(result.deliveryMarkdown)
  result.deliveryMarkdown += '\n人工修改'
  expect(() => deliveredResumeMarkdown(result)).toThrow('COMPLETION_DOCUMENT_OUT_OF_SYNC')
})
