import type {MiniToolApi} from '@/types/minitool'

function getMiniToolApi(): MiniToolApi {
  const api = typeof window !== 'undefined' ? window.xhs?.miniTool : undefined
  if (!api) {
    throw new Error('当前环境不支持小红书小工具能力')
  }
  return api
}

export async function saveImageToAlbum(dataUri: string): Promise<void> {
  const api = getMiniToolApi()
  if (typeof api.writeTempFile !== 'function' || typeof api.saveImageToPhotosAlbum !== 'function') {
    throw new Error('当前环境不支持保存到相册')
  }

  const {filePath} = await api.writeTempFile({data: dataUri})
  await api.saveImageToPhotosAlbum({filePath})
}

export async function publishReportNote(options: {
  title: string
  content: string
  imageUri: string
}): Promise<void> {
  const api = getMiniToolApi()
  if (typeof api.postNote !== 'function') {
    throw new Error('当前环境不支持发布笔记')
  }

  await api.postNote({
    title: options.title.slice(0, 20),
    content: options.content.slice(0, 1000),
    pageType: 'photo_publish',
    mediaInfo: {
      image_resources: [{url: options.imageUri}],
    },
  })
}
