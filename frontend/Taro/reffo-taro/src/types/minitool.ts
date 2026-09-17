export interface MiniToolWriteTempFileResult {
  filePath: string
}

export interface MiniToolApi {
  writeTempFile?: (options: {data: string}) => Promise<MiniToolWriteTempFileResult>
  saveImageToPhotosAlbum?: (options: {filePath: string}) => Promise<void>
  postNote?: (options: {
    title?: string
    content?: string
    pageType?: 'photo_publish'
    mediaInfo: {
      image_resources: Array<{url: string}>
    }
  }) => Promise<void>
}

declare global {
  interface Window {
    xhs?: {
      miniTool?: MiniToolApi
    }
  }
}
