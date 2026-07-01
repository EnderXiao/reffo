import {isH5} from './platform'

export interface BrowserPickedFile {
  name: string
  path: string
  size: number
  file?: File
  objectUrl?: string
}

interface PickBrowserFileOptions {
  accept: readonly string[]
}

function createAcceptValue(accept: readonly string[]) {
  return accept.join(',')
}

export function canUseBrowserFilePicker() {
  return (
    isH5() &&
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof File !== 'undefined'
  )
}

export function pickBrowserFile({
  accept,
}: PickBrowserFileOptions): Promise<BrowserPickedFile | null> {
  if (!canUseBrowserFilePicker()) {
    return Promise.resolve(null)
  }

  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = createAcceptValue(accept)
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    input.style.top = '-9999px'

    const cleanup = () => {
      input.remove()
    }

    input.addEventListener('change', () => {
      const file = input.files?.[0]
      cleanup()

      if (!file) {
        resolve(null)
        return
      }

      resolve({
        name: file.name,
        path: URL.createObjectURL(file),
        size: file.size,
        file,
      })
    })

    input.addEventListener('cancel', () => {
      cleanup()
      resolve(null)
    })

    input.addEventListener('error', () => {
      cleanup()
      reject(new Error('文件选择失败'))
    })

    document.body.appendChild(input)
    input.click()
  })
}

export function readBrowserTextFile(file: File): Promise<string> {
  return file.text()
}
