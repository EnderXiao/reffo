import {storage} from '@/utils/storage'

export const SHARE_INVITE_TOKEN_KEY = 'reffo.shareInviteToken'

/**
 * 分享落地页暂存的邀请 token：注册完成后凭它领取双方奖励，领取后立即清除。
 */
export async function saveShareInviteToken(token: string) {
  try {
    await storage.setItem(SHARE_INVITE_TOKEN_KEY, token)
  } catch {
    // 本地存储不可用时静默失败：奖励只是拿不到，不阻塞注册流程。
  }
}

export async function readShareInviteToken(): Promise<string | null> {
  try {
    return await storage.getItem(SHARE_INVITE_TOKEN_KEY)
  } catch {
    return null
  }
}

export async function clearShareInviteToken() {
  try {
    await storage.removeItem(SHARE_INVITE_TOKEN_KEY)
  } catch {
    // 忽略清理失败。
  }
}
