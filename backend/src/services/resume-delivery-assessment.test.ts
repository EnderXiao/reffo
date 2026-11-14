import {describe, expect, test} from 'bun:test'
import {createCompletionDocument, createPlainCompletionDocument} from '@/shared/resume-completion'
import type {ResumeActionReview, ResolvedResumeActionPlan, ResumeChangeManifest} from '@/shared/resume-actions'
import {assessResumeDelivery, RESUME_DELIVERY_GATES, withResumePdfGate} from './resume-delivery-assessment'

const review = (state: 'adopted' | 'pending_review' = 'adopted') => ({outcomes: [{state, validation: state === 'adopted' ? 'deterministic' : 'pending'}]}) as ResumeActionReview
const changeManifest = {structureBasis: {version: 'resume-structure-basis-v1', sourceRevision: 'source', nodes: [], sourceSectionTitles: []}, structureChanges: []} as unknown as ResumeChangeManifest

describe('six delivery gates', () => {
  test('unexecuted gates are explicit and an empty action assessment cannot pass', () => {
    const unknown = assessResumeDelivery({})
    expect(unknown.gates.map(gate => gate.gate)).toEqual([...RESUME_DELIVERY_GATES])
    expect(unknown.gates.every(gate => gate.state === 'not_run')).toBe(true)
    expect(unknown.state).toBe('draft_only')
    const empty = assessResumeDelivery({document: createPlainCompletionDocument('# 示例\n13800000000'), fact: 'pass', supplementEvaluated: true,
      identity: {name: 'known'}, review: {outcomes: []} as unknown as ResumeActionReview})
    expect(empty.gates.find(gate => gate.gate === 'content_actions')?.state).toBe('not_run')
    expect(empty.state).toBe('draft_only')
  })
  test('generation and saved snapshots retain six distinct results without inventing PDF execution', () => {
    const plain = createPlainCompletionDocument('# 示例\n13800000000\n- 负责需求分析。')
    const document = createCompletionDocument({...plain, blocks: plain.blocks.map(block => ({...block,
      segments: block.segments.map(segment => segment.kind === 'text' ? {...segment, origin: 'generated' as const} : segment)}))})
    const generated = assessResumeDelivery({document, identity: {name: 'known'}, fact: 'pass', supplementEvaluated: true, review: review(), changeManifest})
    expect(generated.state).toBe('application_ready')
    expect(generated.gates.find(gate => gate.gate === 'pdf')?.state).toBe('not_run')
    const saved = assessResumeDelivery({document, identity: {name: 'known'}, previous: generated, review: review('pending_review'), changeManifest})
    expect(saved.gates).toHaveLength(6)
    expect(saved.gates.find(gate => gate.gate === 'fact')?.state).toBe('pass')
    expect(saved.gates.find(gate => gate.gate === 'content_actions')?.state).toBe('warning')
    expect(saved.state).toBe('draft_only')
    expect(withResumePdfGate(saved, 'pass').gates.find(gate => gate.gate === 'pdf')?.state).toBe('pass')
    expect(withResumePdfGate(saved, 'block').state).toBe('blocked')
  })
  test('unknown identity and local recovery stay warnings while safe omission is independently checked', () => {
    const state = assessResumeDelivery({document: createPlainCompletionDocument('# 简历\n- 负责需求分析。'), identity: {name: 'missing'},
      fact: 'pass', supplementEvaluated: true, review: review(), recoveredEntryIds: ['entry-1']})
    expect(state.state).toBe('partial_recovery')
    expect(state.gates.find(gate => gate.gate === 'structure_identity')?.state).toBe('warning')
    expect(state.gates.find(gate => gate.gate === 'safe_omission')?.state).toBe('pass')
    expect(state.gates.find(gate => gate.gate === 'content_actions')?.state).toBe('warning')
  })
  test('preparation-only and explicitly omitted actions do not prevent a complete document from being usable', () => {
    const resolvedPlan = {actions: [{actionId: 'learning', operation: 'preparation_only'}, {actionId: 'omitted', operation: 'express_supported_aspect'}],
      bindings: [{actionId: 'learning', selection: 'deferred'}, {actionId: 'omitted', selection: 'omitted_with_reason'}]} as ResolvedResumeActionPlan
    const state = assessResumeDelivery({document: createPlainCompletionDocument('# 示例\n13800000000\n- 负责需求分析。'), identity: {name: 'user_provided'},
      fact: 'pass', supplementEvaluated: true, resolvedPlan, changeManifest,
      review: {outcomes: [{actionId: 'learning', state: 'not_adopted', validation: 'deterministic'}, {actionId: 'omitted', state: 'not_adopted', validation: 'deterministic'}]} as ResumeActionReview})
    expect(state.gates.find(gate => gate.gate === 'content_actions')?.state).toBe('pass')
    expect(state.state).toBe('application_ready')
  })
  test('ordinary user facts retain a provenance warning without pretending the document is incomplete', () => {
    const state = assessResumeDelivery({document: createPlainCompletionDocument('# 用户填写姓名\n13800000000\n- 本人补充已完成需求评审。'),
      identity: {name: 'user_provided'}, fact: 'pass', supplementEvaluated: true, review: review(), changeManifest})
    expect(state.gates.find(gate => gate.gate === 'fact')?.state).toBe('warning')
    expect(state.state).toBe('application_ready')
  })
  test('malformed historical review stays unassessed instead of crashing or passing', () => {
    const state = assessResumeDelivery({document: createPlainCompletionDocument('# 示例\n13800000000'), review: {outcomes: 'invalid'} as unknown as ResumeActionReview})
    expect(state.gates.find(gate => gate.gate === 'content_actions')?.state).toBe('not_run')
  })
  test('source identity omissions remain a structure warning after a name gap is filled or removed', () => {
    const needsReview = {...changeManifest, structureChanges: [{kind: 'identity_boundary', validation: 'needs_review', description: '实习身份和来源雇主未完整呈现。'}]} as ResumeChangeManifest
    const state = assessResumeDelivery({document: createPlainCompletionDocument('# 已填姓名\n13800000000\n- 负责产品需求。'),
      identity: {name: 'user_provided'}, fact: 'pass', supplementEvaluated: true, review: review(), changeManifest: needsReview})
    expect(state.gates.find(gate => gate.gate === 'structure_identity')).toMatchObject({state: 'warning', reasons: ['实习身份和来源雇主未完整呈现。']})
    expect(state.state).toBe('draft_only')
  })
  test('missing or malformed source structure assessment is explicit not_run', () => {
    for (const manifest of [undefined, {...changeManifest, structureChanges: 'invalid'} as unknown as ResumeChangeManifest]) {
      const state = assessResumeDelivery({document: createPlainCompletionDocument('# 姓名\n13800000000'), identity: {name: 'known'}, changeManifest: manifest})
      expect(state.gates.find(gate => gate.gate === 'structure_identity')?.state).toBe('not_run')
    }
  })
})
