import Taro from '@tarojs/taro'
import {parseApi} from '@/services/parse'
import {
  canUseBrowserFilePicker,
  pickBrowserFile,
  readBrowserTextFile,
} from '@/utils/web-file'
import {
  formatResumeFileSize,
  pickAndParseResumeFile,
} from '../resume-file-upload'

jest.mock('@tarojs/taro', () => ({
  __esModule: true,
  default: {
    chooseMessageFile: jest.fn(),
    getFileSystemManager: jest.fn(),
  },
}))

jest.mock('@/services/parse', () => ({
  parseApi: {
    parseResumeFile: jest.fn(),
  },
}))

jest.mock('@/utils/web-file', () => ({
  canUseBrowserFilePicker: jest.fn(),
  pickBrowserFile: jest.fn(),
  readBrowserTextFile: jest.fn(),
}))

const mockCanUseBrowserFilePicker = canUseBrowserFilePicker as jest.Mock
const mockPickBrowserFile = pickBrowserFile as jest.Mock
const mockReadBrowserTextFile = readBrowserTextFile as jest.Mock
const mockParseResumeFile = parseApi.parseResumeFile as jest.Mock
const mockChooseMessageFile = Taro.chooseMessageFile as jest.Mock

describe('resume-file-upload', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCanUseBrowserFilePicker.mockReturnValue(true)
  })

  test('浏览器文本简历复用统一进度并返回标准文件信息', async () => {
    const file = {
      name: 'resume.md',
      path: 'blob:resume',
      size: 2048,
      file: {} as File,
    }
    const onFileSelected = jest.fn()
    const onProgress = jest.fn()
    mockPickBrowserFile.mockResolvedValue(file)
    mockReadBrowserTextFile.mockResolvedValue('  # Resume\n\nExperience  ')

    const result = await pickAndParseResumeFile({onFileSelected, onProgress})

    expect(onFileSelected).toHaveBeenCalledWith({...file, extension: '.md'})
    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([18, 52, 84])
    expect(result).toEqual({
      ...file,
      extension: '.md',
      extractedText: '# Resume\n\nExperience',
    })
    expect(mockParseResumeFile).not.toHaveBeenCalled()
  })

  test('PDF 通过同一解析服务提取 Markdown', async () => {
    const file = {
      name: 'resume.pdf',
      path: '/tmp/resume.pdf',
      size: 2 * 1024 * 1024,
    }
    mockCanUseBrowserFilePicker.mockReturnValue(false)
    mockChooseMessageFile.mockResolvedValue({tempFiles: [file]})
    mockParseResumeFile.mockResolvedValue({markdown: '# PDF Resume', rawText: ''})

    const result = await pickAndParseResumeFile()

    expect(mockParseResumeFile).toHaveBeenCalledWith(file)
    expect(result?.extension).toBe('.pdf')
    expect(result?.extractedText).toBe('# PDF Resume')
    expect(formatResumeFileSize(file.size)).toBe('2.0 Mb')
  })

  test('超过 10MB 的文件在解析前被拒绝', async () => {
    mockPickBrowserFile.mockResolvedValue({
      name: 'resume.pdf',
      path: 'blob:large-resume',
      size: (10 * 1024 * 1024) + 1,
      file: {} as File,
    })

    await expect(pickAndParseResumeFile()).rejects.toThrow('文件不能超过 10MB')
    expect(mockParseResumeFile).not.toHaveBeenCalled()
  })
})
