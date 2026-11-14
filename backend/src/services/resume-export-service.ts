import {randomUUID} from 'node:crypto'
import {createCanonicalDigest} from '@/harness/run-context'
import type {RequestUserContext} from '@/auth/request-context'
import type {ResumeHistoryRepositoryContract} from '@/repositories/interfaces'
import {resumeHistoryRepository} from '@/repositories/resume-history-repository'
import {resumeExportRepository, type ResumeExportRow, type ResumeExportStorage} from '@/repositories/resume-export-repository'
import {completionIdentityName, hasLinkedCompletion, normalizeCompletionDocument, prepareResumeExport, type ResumeCompletionDocument} from '@/shared/resume-completion'
import {env} from '@/config/env'
import {ChromiumResumePdfRenderer, ResumePdfRenderError, type ResumePdfRenderer} from './pdf/chromium-renderer'
import {RESUME_PDF_TEMPLATE_VERSION, resumePdfBlocks} from './pdf/resume-template'
import {assessResumeDelivery, withResumePdfGate} from './resume-delivery-assessment'
import type {ResumeActionReview, ResumeIdentityState, ResolvedResumeActionPlan, ResumeChangeManifest} from '@/shared/resume-actions'

export class ResumeExportError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {super(message); this.name = 'ResumeExportError'}
}
export interface CreateResumeExportInput {request_id: string; document_id: string; expected_revision: number; format: 'pdf'}
const digest = createCanonicalDigest
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const namePart = (value: string) => value.replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '').trim().slice(0, 100)

export function resumeExportMetadata(row: ResumeExportRow) {
  return {export_id: row.id, status: Date.parse(row.expires_at) <= Date.now() ? 'expired' as const : row.status,
    document_id: row.document_id, revision: row.revision, disposition: row.disposition, file_name: row.file_name,
    reason_codes: row.reason_codes, omitted_count: row.omitted_count, omitted_claim_count: row.omitted_claim_count,
    delivery_state: withResumePdfGate(row.delivery_state ?? assessResumeDelivery({}), row.status === 'ready' ? 'pass' : row.status === 'failed' ? 'block' : 'not_run'),
    omitted_gap_ids: row.omitted_gap_ids ?? [], omitted_claim_ids: row.omitted_claim_ids ?? [],
    download_path: `/api/v1/resume-history/${encodeURIComponent(row.history_id)}/exports/${encodeURIComponent(row.id)}/file`}
}

/** Current document header is authoritative. Generic template titles never become candidate names. */
function currentIdentity(document: ResumeCompletionDocument, markdown: string, identityState: unknown) {
  const direct = completionIdentityName(document) || ''
  const heading = markdown.split('\n').find(line => /^#\s+/u.test(line))?.replace(/^#\s+/u, '').trim() || ''
  const generic = /^(?:resume|curriculum vitae|简历|个人简历|相契简历|待完善稿|待完善简历|用户|候选人)$/iu
  const knownHeader = !hasLinkedCompletion(document) || record(identityState).name === 'known'
  const name = namePart(direct || (knownHeader && !generic.test(heading) && !/[【】\[\]]|经理|工程师|设计师|求职意向|岗位/u.test(heading) && heading.length <= 40 ? heading : ''))
  return {name, hasContact: /(?:1[3-9]\d{9}|\b[^\s@]+@[^\s@]+\.[^\s@]+\b)/u.test(markdown)}
}

export class ResumeExportService {
  constructor(private readonly histories: Pick<ResumeHistoryRepositoryContract, 'findById'> = resumeHistoryRepository,
    private readonly storage: ResumeExportStorage = resumeExportRepository,
    private readonly renderer: ResumePdfRenderer = new ChromiumResumePdfRenderer({executablePath: env.PDF_CHROMIUM_EXECUTABLE_PATH || undefined,
      timeoutMs: env.PDF_RENDER_TIMEOUT_MS, maxConcurrent: env.PDF_MAX_CONCURRENT}),
    private readonly ttlMs = env.PDF_EXPORT_TTL_MS) {}

  private async history(context: RequestUserContext, historyId: string) {
    const history = await this.histories.findById(context, historyId)
    if (!history) throw new ResumeExportError('RESUME_HISTORY_NOT_FOUND', '生成卡片历史不存在或已删除', 404)
    return history
  }

  async create(context: RequestUserContext, historyId: string, input: CreateResumeExportInput) {
    await this.storage.cleanup()
    const history = await this.history(context, historyId)
    const requestDigest = digest({historyId, ...input})
    const existing = await this.storage.findRequest(context.userId,input.request_id)
    if (existing) {
      if (existing.request_digest !== requestDigest) throw new ResumeExportError('RESUME_EXPORT_REQUEST_CONFLICT','下载请求已用于其他版本，请重新下载',409)
      if (Date.parse(existing.expires_at)<=Date.now() || existing.status==='revoked') throw new ResumeExportError('RESUME_EXPORT_EXPIRED','下载文件已过期，请重新下载',410)
      if (existing.status==='failed') throw new ResumePdfRenderError()
      if (existing.status==='pending' && existing.model && this.storage.claim) {
        const reclaimed=await this.storage.claim(context.userId,existing.id,randomUUID(),new Date(Date.now()+60_000).toISOString())
        if (reclaimed) return this.render(context,historyId,reclaimed)
      }
      return resumeExportMetadata(existing)
    }
    const optimized = record(record(history.process_result).optimized)
    const loaded = normalizeCompletionDocument(history.optimized_content, optimized.completion_document)
    if (loaded.blocked || loaded.status === 'repair_required') throw new ResumeExportError('RESUME_COMPLETION_INVALID', '填写结构需要恢复，请检查对应行后再下载', 422)
    const document = loaded.document
    if (input.document_id !== document.documentId || input.expected_revision !== document.revision) {
      throw new ResumeExportError('RESUME_EXPORT_VERSION_CONFLICT', '当前稿已更新，请先保存当前版本后再下载', 409)
    }
    const prepared = prepareResumeExport(document, history.optimized_content)
    if (!prepared.ok) throw new ResumeExportError('RESUME_EXPORT_UNSAFE', prepared.issues.map(issue => issue.message).join('；'), 422)
    const identity = currentIdentity(document, prepared.markdown, optimized.identity_state)
    const deliveryState = assessResumeDelivery({document, identity: optimized.identity_state as ResumeIdentityState | undefined,
      review: optimized.action_review as ResumeActionReview | undefined, resolvedPlan: optimized.resolved_action_plan as ResolvedResumeActionPlan | undefined,
      changeManifest: optimized.change_manifest as ResumeChangeManifest | undefined, previous: optimized.delivery_state})
    const reasonCodes = [!identity.name ? 'NAME_MISSING' : '', !identity.hasContact ? 'CONTACT_MISSING' : '',
      prepared.omittedCount ? 'OPTIONAL_DETAIL_OMITTED' : '', prepared.omittedClaimCount ? 'UNRESOLVED_CLAIM_OMITTED' : ''].filter(Boolean)
    const incomplete = prepared.omittedCount > 0 || (prepared.omittedClaimCount ?? 0) > 0 || deliveryState.state !== 'application_ready'
    if(incomplete)reasonCodes.push('CONTENT_INCOMPLETE')
    const disposition = !identity.name || !identity.hasContact || incomplete ? 'draft_only' as const : 'application_ready' as const
    const eligibilityDigest = digest({document,markdown:prepared.markdown,review:optimized.action_review??null,
      plan:optimized.resolved_action_plan??null,identity:optimized.identity_state??null,disposition,template:RESUME_PDF_TEMPLATE_VERSION})
    const now = new Date()
    const position = namePart(history.position) || '目标岗位'
    const info = record(record(record(history.process_result).analysis).structured_resume)
    const schools = Array.isArray(info.education) ? info.education : []
    const school = namePart(String(record(optimized.identity_state).school || (hasLinkedCompletion(document) ? '' : record(schools[0]).school) || ''))
    const fileName = disposition === 'draft_only' ? `待完善简历_${position}_${new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)}.pdf`
      : [identity.name, school, position].filter(Boolean).join('_') + '.pdf'
    const row: ResumeExportRow = {id: randomUUID(), owner_id: context.userId, history_id: historyId, request_id: input.request_id,
      request_digest: requestDigest, eligibility_digest:eligibilityDigest,lease_token:randomUUID(),lease_expires_at:new Date(Date.now()+60_000).toISOString(),
      omitted_gap_ids:prepared.omittedGapIds??[],omitted_claim_ids:prepared.omittedClaimIds??[],document_id: document.documentId, revision: document.revision, template_version: RESUME_PDF_TEMPLATE_VERSION,
      delivery_state: deliveryState,
      status: 'pending', disposition, file_name: fileName, reason_codes: reasonCodes, omitted_count: prepared.omittedCount,
      omitted_claim_count: prepared.omittedClaimCount ?? 0, model: {version: 'resume-pdf-model-v1', title: identity.name || '待完善简历', disposition,
        blocks: resumePdfBlocks(prepared.markdown)}, file_base64: null, created_at: now.toISOString(), expires_at: new Date(now.getTime() + this.ttlMs).toISOString()}
    const stored = await this.storage.insert(row)
    if (stored.request_digest !== requestDigest) throw new ResumeExportError('RESUME_EXPORT_REQUEST_CONFLICT', '下载请求已用于其他版本，请重新下载', 409)
    if (stored.id !== row.id) return resumeExportMetadata(stored)
    return this.render(context,historyId,stored)
  }

  private async render(context: RequestUserContext,historyId: string,row: ResumeExportRow) {
    try {
      const bytes = await this.renderer.render(row.model!)
      if (!await this.histories.findById(context, historyId)) {
        await this.storage.revokeHistory(context.userId, historyId)
        throw new ResumeExportError('RESUME_HISTORY_NOT_FOUND', '生成卡片历史不存在或已删除', 404)
      }
      const ready = await this.storage.finish(context.userId, row.id, 'ready', Buffer.from(bytes).toString('base64'),row.lease_token??undefined)
      if (!ready) throw new ResumeExportError('RESUME_EXPORT_EXPIRED', '下载文件已撤销或过期，请重新下载', 410)
      return resumeExportMetadata(ready)
    } catch (error) {
      await this.storage.finish(context.userId, row.id, 'failed', null,row.lease_token??undefined)
      throw error
    }
  }

  async get(context: RequestUserContext, historyId: string, exportId: string) {
    await this.history(context, historyId)
    const row = await this.storage.find(context.userId, exportId)
    if (!row || row.history_id !== historyId) throw new ResumeExportError('RESUME_EXPORT_NOT_FOUND', '未找到下载文件', 404)
    if (row.status === 'revoked' || Date.parse(row.expires_at) <= Date.now()) throw new ResumeExportError('RESUME_EXPORT_EXPIRED', '下载文件已过期，请重新下载', 410)
    return row
  }

  async file(context: RequestUserContext, historyId: string, exportId: string) {
    const row = await this.get(context, historyId, exportId)
    if (row.status === 'failed') throw new ResumePdfRenderError()
    if (row.status !== 'ready' || !row.file_base64) throw new ResumeExportError('RESUME_EXPORT_PENDING', 'PDF正在生成，请稍后重试', 409)
    return {row, bytes: new Uint8Array(Buffer.from(row.file_base64, 'base64'))}
  }
}

export const resumeExportService = new ResumeExportService()

let cleanupTimer: ReturnType<typeof setInterval> | undefined
export function startResumeExportCleanup() {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {void resumeExportRepository.cleanup().catch(() => console.error('短期导出清理失败'))}, 60_000)
  cleanupTimer.unref?.()
}
