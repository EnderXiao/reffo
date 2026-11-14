import {bindPreparationTopicsToCases} from '@/v5/preparation-topics'
import {completionDocumentFromSnapshot, ResumeCompletionSnapshotError} from './resume-completion-snapshot'
import {ResumeHistoryCommitError} from './resume-history-commit'
import {savedInterviewGenerationBasis} from '@/v5/current-interview-snapshot'
import {routeSourceInformation, type InterviewPreparationTopic} from '@/v5/writing/information-routing'
import {actionContentDigest, freezeActionPlan, freezeResolvedActionPlan, reconcileEditorialActions, buildChangeManifest,
  changeManifestDescriptions, type ResumeActionPlan, type ResolvedResumeActionPlan, type ResumeActionReview, type ResumeChangeManifest, type ResumeIdentityState} from '@/shared/resume-actions'
import {collectGaps, COMPLETION_TEMPLATES, createCompletionDocument, dependentClaimExportable, renderCompletionHint, renderCompletionSegment,
  serializeDraft, validateCompletionDocument, validateOmissionSafety,
  type CompletionGap, type ResumeCompletionDocument, type ResumeCompletionSegment, type ResumeDependentClaim} from '@/shared/resume-completion'
import type {ResumeHistoryRecord} from '@/types'
import {assessResumeDelivery} from './resume-delivery-assessment'

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const preparationDimensions = {metric_definition: 'definition', metric_period: 'period', metric_population: 'population', human_intervention: 'human_intervention'} as const
const metadataGap = (gap: CompletionGap) => gap.template in preparationDimensions
const normalized = (text: string) => text.replace(/(?:来源记录|原材料记录|原简历记载|述职材料记录)/gu, '').replace(/[\s\p{P}\p{S}]/gu, '')
const clauses = (text: string) => text.split(/[；;。！？!?，]|(?<!\d),(?!\d{3}(?:\D|$))/u).map(value => value.trim()).filter(Boolean)
function claimProbe(claim: ResumeDependentClaim) {
  return claim.parts.filter(part => part.kind === 'text' && !part.segmentId.startsWith(`${claim.claimId}:subject:`))
    .map(part => part.kind === 'text' ? part.markdown : '').join('')
}

/** Match assertions, not entire atoms: sibling metrics may have different admission decisions. */
function supportedClaimFragments(claim: ResumeDependentClaim, routed: ReturnType<typeof routeSourceInformation>) {
  const probes = clauses(claimProbe(claim)).map(normalized).filter(text => text.length >= 3)
  const candidates = [...routed.assertions.filter(assertion => claim.sourceEvidenceIds.includes(assertion.evidenceId)
    && assertion.resumeText && ['use_source', 'safe_projection'].includes(assertion.resumeDisposition))
    .flatMap(assertion => clauses(assertion.resumeText)), ...claim.sourceEvidenceIds.filter(id => !routed.assertions.some(assertion => assertion.evidenceId === id))
      .flatMap(id => clauses(routed.admittedTextByEvidence.get(id) ?? ''))]
  return [...new Set(candidates.filter(text => {
      const candidate = normalized(text)
      return candidate.length >= 3 && probes.some(probe => probe.includes(candidate) || candidate.includes(probe))
    }))]
}

function withoutRetiredParts(claim: ResumeDependentClaim, retiredIds: Set<string>) {
  const retiredSubjects = new Set(claim.parts.flatMap((part, index) => part.kind === 'required_detail_gap' && retiredIds.has(part.gapId)
    && claim.parts[index - 1]?.kind === 'text' && (claim.parts[index - 1] as {segmentId: string}).segmentId.startsWith(`${claim.claimId}:subject:`)
    ? [(claim.parts[index - 1] as {segmentId: string}).segmentId] : []))
  return claim.parts.filter(part => part.kind === 'text' ? !retiredSubjects.has(part.segmentId) : !retiredIds.has(part.gapId))
}
export interface CompletionUpgradeExpected {documentId: string; revision: number; digest: string}

/** Called only with an owned repository row. It never treats a public snapshot as source evidence. */
export function upgradeResumeCompletion(history: ResumeHistoryRecord, expected: CompletionUpgradeExpected): ResumeHistoryRecord {
  const old = completionDocumentFromSnapshot(history.process_result)
  if (!old) throw new ResumeCompletionSnapshotError('RESUME_COMPLETION_INVALID', '当前记录没有可升级的填写文档')
  if (!validateCompletionDocument(old, history.optimized_content).ok) throw new ResumeCompletionSnapshotError('RESUME_COMPLETION_INVALID', '正文与填写状态不一致，原始内容已保留')
  if (old.schemaVersion === 'resume-completion-v4') return history
  if (old.documentId !== expected.documentId || old.revision !== expected.revision || actionContentDigest(old) !== expected.digest) {
    throw new ResumeHistoryCommitError('RESUME_VERSION_CONFLICT', '当前稿已更新，请保留本地修改并重新打开')
  }
  const result = object(history.process_result), optimized = object(result.optimized)
  const basis = savedInterviewGenerationBasis(history)
  const routed = routeSourceInformation({atoms: basis?.resumeEvidenceBundle.evidenceAtoms ?? [], actions: basis?.resolvedActionPlan?.actions})
  const topics = basis ? bindPreparationTopicsToCases(routed.preparationTopics, basis.resumeEvidenceBundle) : structuredClone(routed.preparationTopics)
  const migratedEvidence = new Map<string, string[]>()
  const rejectedClaims: ResumeDependentClaim[] = []
  const retired: Array<{gapId: string; detailId?: string; topicId: string}> = []
  const retire = (gap: CompletionGap, claim?: ResumeDependentClaim) => {
    const ids = claim?.sourceEvidenceIds ?? []
    const atom = basis?.resumeEvidenceBundle.evidenceAtoms.find(atom => ids.includes(atom.evidenceId))
    const rawSubject = gap.label.split('｜')[0]
    const isGeneric = Object.values(COMPLETION_TEMPLATES).some(template => template.label === rawSubject)
    const scopedTopics = topics.filter(topic => topic.sourceEvidenceIds.some(id => ids.includes(id)))
    const exact = !isGeneric ? scopedTopics.find(topic => normalized(topic.subject) === normalized(rawSubject)) : undefined
    // Legacy labels can stop before attribution words (e.g. "审核耗时" vs
    // "审核耗时由人工"). Require a unique match in the same evidence atom.
    const subjectPrefix = !isGeneric && normalized(rawSubject).length >= 4
      ? scopedTopics.filter(topic => normalized(topic.subject).startsWith(normalized(rawSubject))) : []
    let topic = exact ?? (subjectPrefix.length === 1 ? subjectPrefix[0] : undefined) ?? (scopedTopics.length === 1 ? scopedTopics[0] : undefined)
    const subject = !isGeneric && rawSubject ? rawSubject : claim ? clauses(claimProbe(claim)).join('、').slice(0, 100) || '本项结果' : '本项结果'
    const dimension = preparationDimensions[gap.template as keyof typeof preparationDimensions]
    if (!topic) {
      const related = basis?.resolvedActionPlan?.actions.filter(action => action.detailIds.includes(gap.detailId ?? '') || action.actionId && gap.actionIds?.includes(action.actionId)) ?? []
      const topicId = `preparation:${actionContentDigest([old.documentId, atom?.sourceScopeId, claim?.claimId ?? gap.gapId, ids, subject])}`
      topic = topics.find(item => item.topicId === topicId)
      if (!topic) {topic = {topicId, scopeId: atom?.sourceScopeId ?? `legacy:${old.documentId}`,
        subject, dimensions: dimension ? [dimension] : [], sourceEvidenceIds: ids,
        sourceSpans: atom ? [{sourceBlockId: atom.sourceBlockId, ...atom.sourceSpan}] : [],
        requirementIds: [...new Set(related.flatMap(action => action.requirementIds))], actionIds: [...new Set([...(gap.actionIds ?? []), ...related.map(action => action.actionId)])],
        sourceAssertionStatus: claim?.readiness === 'conflicted' ? 'conflicted' : !atom || claim?.readiness === 'context_incomplete' ? 'meaning_incomplete' : 'recorded',
        sourceStatement: claim ? claimProbe(claim) : atom?.verbatimText ?? '', prompt: `面试时如何解释「${subject}」的计算口径及结果依据？`,
        preparationFocus: '准备该指标的定义、统计范围和取数依据，区分个人贡献与团队成果。'}
      topics.push(topic)}
    }
    if (dimension && !topic.dimensions.includes(dimension)) topic.dimensions.push(dimension)
    if (claim?.resolution?.state === 'rejected') {
      topic.sourceAssertionStatus = 'conflicted'
      topic.prompt = `关于「${topic.subject}」，哪些记录可以支持实际结果，哪些不能使用？`
    }
    if (gap.fill.state === 'filled') topic.userNotes = [...(topic.userNotes ?? []), {detailId: gap.detailId, text: gap.fill.value,
      provenance: {documentId: old.documentId, revision: old.revision, gapId: gap.gapId}}]
    retired.push({gapId: gap.gapId, detailId: gap.detailId, topicId: topic.topicId})
  }
  const withHint = <T extends CompletionGap>(gap: T): T => ({...gap, hint: renderCompletionHint({...gap, hint: undefined})})
  const blocks = structuredClone(old.blocks).map(block => ({...block, segments: block.segments.flatMap((segment): ResumeCompletionSegment[] => {
    if (segment.kind === 'text') return [segment] // A user's whole-line rewrite is never regex-cleaned.
    if (segment.kind !== 'dependent_claim') {
      if (metadataGap(segment)) {retire(segment); return []}
      return [withHint(segment)]
    }
    const metadata = segment.parts.filter((part): part is Extract<CompletionGap, {kind: 'required_detail_gap'}> => part.kind === 'required_detail_gap' && metadataGap(part))
    for (const gap of metadata) retire(gap, segment)
    const remaining = segment.parts.filter(part => part.kind === 'required_detail_gap' && !metadataGap(part))
    // Explicit rejection is permanent, even if methodological requirements retire.
    if (segment.resolution?.state === 'rejected') {rejectedClaims.push(segment); return []}
    const fragments = supportedClaimFragments(segment, routed)
    const supportedText = normalized(fragments.join(''))
    const numericTokens = claimProbe(segment).match(/\d+(?:[,.]\d+)*(?:%|％)?/gu) ?? []
    const supported = fragments.length > 0 && numericTokens.every(token => supportedText.includes(normalized(token)))
    if (remaining.length && segment.readiness === 'metadata_missing' && supported) return [{...segment, parts: withoutRetiredParts(segment, new Set(metadata.map(gap => gap.gapId))).map(part => part.kind === 'text' ? part : withHint(part)),
      requiredGapIds: remaining.map(part => part.kind === 'required_detail_gap' ? part.gapId : '')}]
    // An unresolved result cannot be repaired just by reporting its implementation stage.
    // Preserve answers as preparation notes rather than leaving a permanently blocked blank.
    for (const gap of remaining) if (gap.kind === 'required_detail_gap') retire(gap, segment)
    const text = fragments.filter(fragment => !block.segments.some(sibling => sibling !== segment && sibling.kind === 'text'
      && normalized(sibling.markdown).includes(normalized(fragment)))).join('；')
    if (!text.trim()) return []
    block.outputPath ??= `migration.${block.blockId}`
    migratedEvidence.set(block.blockId, [...new Set([...(migratedEvidence.get(block.blockId) ?? []), ...segment.sourceEvidenceIds])])
    // Metadata absence alone does not invalidate a recorded result. Routing keeps only supported fragments.
    const index = block.segments.indexOf(segment), previous = block.segments[index - 1]
    const separator = previous?.kind === 'text' && /[。！？!?；;]\s*$/u.test(previous.markdown) ? '' : previous ? '；' : ''
    return [{kind: 'text', segmentId: `${segment.claimId}:v4-source`, markdown: `${separator}${text.replace(/^[，；,;]/u, '').replace(/[。；;]$/u, '')}。`,
      origin: 'generated', ...(segment.unitId ? {unitId: segment.unitId} : {}), ...(segment.actionIds ? {actionIds: segment.actionIds} : {})}]
  })}))
  for (const block of blocks) if (migratedEvidence.has(block.blockId) && !block.outputPath) block.outputPath = `migration.${block.blockId}`
  const document = createCompletionDocument({documentId: old.documentId, schemaVersion: 'resume-completion-v4', blocks})
  document.revision = old.revision + 1
  if (old.claimLineage) document.claimLineage = structuredClone(old.claimLineage)
  if (rejectedClaims.length) {
    document.claimLineage ??= []
    for (const claim of rejectedClaims) if (!document.claimLineage.some(item => item.claimId === claim.claimId)) {
      document.claimLineage.push({claimId: claim.claimId, originalClaim: structuredClone(claim), resolution: structuredClone(claim.resolution!)})
    }
  }
  const markdown = serializeDraft(document)
  if (!validateCompletionDocument(document, markdown).ok || validateOmissionSafety(document).length) {
    throw new ResumeCompletionSnapshotError('RESUME_COMPLETION_INVALID', '当前旧稿无法安全升级，原始内容与填写已保留')
  }
  const oldPlan = optimized.action_plan as ResumeActionPlan | undefined
  const oldResolved = optimized.resolved_action_plan as ResolvedResumeActionPlan | undefined
  const activeDetails = new Set(collectGaps(document).flatMap(gap => gap.detailId ?? []))
  const retiredDetails = new Set(retired.flatMap(item => item.detailId ?? []))
  const rerouteAction = (action: import('@/shared/resume-actions').OptimizationAction) => action.detailIds.some(id => retiredDetails.has(id))
    && !action.detailIds.some(id => activeDetails.has(id)) && ['add_detail_gap', 'isolate_claim'].includes(action.operation)
    ? {...action, operation: 'preparation_only' as const, detailIds: [], expectedEffect: '在对应项目的面试准备中解释指标口径与依据。'} : action
  const plan = oldPlan ? freezeActionPlan({planId: oldPlan.planId, sourceRevision: oldPlan.sourceRevision, judgmentRevision: oldPlan.judgmentRevision, actions: oldPlan.actions.map(rerouteAction)}) : undefined
  const resolved = oldResolved && plan ? freezeResolvedActionPlan({resolvedPlanId: oldResolved.resolvedPlanId, revision: oldResolved.revision + 1,
    basePlanId: plan.planId, baseDigest: plan.baseDigest, actions: oldResolved.actions.map(rerouteAction),
    bindings: oldResolved.bindings.map(binding => oldResolved.actions.some(action => action.actionId === binding.actionId && rerouteAction(action).operation === 'preparation_only')
      ? {...binding, selection: 'deferred' as const, selectionReason: '指标解释已迁入面试准备。', destination: undefined} : binding)}) : undefined
  const review = resolved ? reconcileEditorialActions({resolvedPlan: resolved, document, previousReview: optimized.action_review as ResumeActionReview | undefined}) : undefined
  const manifest = review && resolved ? buildChangeManifest(review, resolved, {document, previous: optimized.change_manifest as ResumeChangeManifest | undefined}) : undefined
  const delivery = assessResumeDelivery({document, identity: optimized.identity_state as ResumeIdentityState | undefined,
    resolvedPlan: resolved, review, changeManifest: manifest, previous: optimized.delivery_state, supplementEvaluated: true})
  const archive = {version: 'resume-completion-upgrade-v1', migrationId: actionContentDigest([old.documentId, old.revision, expected.digest]),
    originalDigest: expected.digest, upgradedDigest: actionContentDigest(document), originalDocument: old, retiredGaps: retired,
    originalActionPlan: oldPlan, originalResolvedPlan: oldResolved, originalInterviewBasis: basis, migratedAt: new Date().toISOString()}
  const finalTopics = basis ? bindPreparationTopicsToCases(topics, basis.resumeEvidenceBundle) : topics
  const migratedBasis = basis ? structuredClone(basis) : undefined
  if (migratedBasis) for (const block of document.blocks) {
    const evidenceIds = migratedEvidence.get(block.blockId)
    if (!evidenceIds?.length || !block.outputPath) continue
    const prior = migratedBasis.artifact.claims.find(claim => claim.outputPath === block.outputPath)
    migratedBasis.artifact.claims = migratedBasis.artifact.claims.filter(claim => claim.outputPath !== block.outputPath)
    migratedBasis.artifact.claims.push({claimId: `migration:${block.blockId}`, outputPath: block.outputPath,
      outputText: block.segments.map(segment => segment.kind === 'dependent_claim' && !dependentClaimExportable(segment, document.schemaVersion)
        ? '' : renderCompletionSegment(segment, 'export')).join(''), evidenceIds: [...new Set([...(prior?.evidenceIds ?? []), ...evidenceIds])],
      transformation: 'safe_paraphrase', attributionLevel: prior?.attributionLevel ?? 'unspecified'})
  }
  return {...history, optimized_content: markdown, ...(manifest ? {changes_summary: changeManifestDescriptions(manifest)} : {}), process_result: {
    ...result, server_completion_upgrade_archive: archive,
    ...(migratedBasis ? {server_interview_basis: {version: 'interview-generation-basis-v1', result: {...migratedBasis, preparationTopics: finalTopics, completionDocument: document, resolvedActionPlan: resolved ?? migratedBasis.resolvedActionPlan}}} : {}),
    optimized: {...optimized, completion_document: document, optimized_resume: markdown, preparation_topics: finalTopics,
      ...(plan ? {action_plan: plan} : {}), ...(resolved ? {resolved_action_plan: resolved} : {}), ...(review ? {action_review: review} : {}),
      ...(manifest ? {change_manifest: manifest, changes_summary: changeManifestDescriptions(manifest)} : {}), delivery_state: delivery},
  }}
}
