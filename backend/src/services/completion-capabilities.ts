import {hasLinkedCompletion, isCompletionV4} from '@/shared/resume-completion'

export function acceptsLinkedResume(headers: Record<string, string | undefined>) {
  return hasLinkedCompletion(headers['x-reffo-completion-schema'])
}
export function requireLinkedResumeCapability(headers: Record<string, string | undefined>) {
  if (!isCompletionV4(headers['x-reffo-completion-schema'])) throw Object.assign(new Error('当前客户端需要更新后才能接收新版填写简历；已保存记录仍可查看。'),
    {code: 'RESUME_CLIENT_UPGRADE_REQUIRED', status: 409})
}
