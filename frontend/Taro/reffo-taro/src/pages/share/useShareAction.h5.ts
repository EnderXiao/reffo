import {useState} from 'react'
import {shareApi} from '@/services/share'
import type {ShareContentMode} from '@/types/share'
import {feedback} from '@/utils/feedback'
import {renderShareImage} from '@/utils/share/share-image-renderer.h5'
import {buildShareImageFilename} from '@/utils/share/share-image-spec'
import {
  saveShareImage,
  shareOrCopyUrl,
} from '@/utils/share/share-platform.h5'

interface UseShareActionOptions {
  historyId: string | null
  mode: ShareContentMode
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function useShareAction({historyId, mode}: UseShareActionOptions) {
  const [busyChannel, setBusyChannel] = useState<'image' | 'link' | null>(null)

  const createLink = async (createdVia: 'image' | 'link') => {
    if (!historyId) throw new Error('生成记录尚未准备完成')
    return shareApi.createLink(
      {
        history_id: historyId,
        mode,
        created_via: createdVia,
      },
      `share-${historyId}-${mode}`,
    )
  }

  const shareImage = async () => {
    if (busyChannel) return
    setBusyChannel('image')
    try {
      const createdLink = await createLink('image')
      const share = await shareApi.getPublicLink(createdLink.token)
      const blob = await renderShareImage(share, createdLink.share_url)
      const result = await saveShareImage(
        blob,
        buildShareImageFilename(share),
        '分享你的新工牌',
      )
      if (result !== 'cancelled') {
        feedback.toast({
          title: result === 'shared' ? '分享图已发送' : '分享图已保存',
          icon: 'success',
        })
      }
    } catch (error) {
      feedback.toast({
        title: getErrorMessage(error, '分享图生成失败，请重试'),
        icon: 'error',
      })
    } finally {
      setBusyChannel(null)
    }
  }

  const shareLink = async () => {
    if (busyChannel) return
    setBusyChannel('link')
    try {
      const link = await createLink('link')
      const result = await shareOrCopyUrl(
        link.share_url,
        '一个岗位，一份专门准备的简历',
        mode === 'job'
          ? '看看我用 Reffo 准备的新简历。'
          : '试试 Reffo，为下一个岗位准备一份专门的简历。',
      )
      if (result === 'manual') {
        feedback.modal({
          title: '复制分享链接',
          content: link.share_url,
          confirmText: '知道了',
          showCancel: false,
        })
      } else if (result !== 'cancelled') {
        feedback.toast({
          title: result === 'shared' ? '分享链接已发送' : '分享链接已复制',
          icon: 'success',
        })
      }
    } catch (error) {
      feedback.toast({
        title: getErrorMessage(error, '分享链接创建失败，请重试'),
        icon: 'error',
      })
    } finally {
      setBusyChannel(null)
    }
  }

  return {
    busyChannel,
    shareImage,
    shareLink,
  }
}
