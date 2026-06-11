import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import React from 'react'
import { render, fireEvent, waitFor } from '@testing-library/react'
import Taro from '@tarojs/taro'
import { ResumeUploader } from '../index'

// Mock Taro APIs
const mockChooseMessageFile = jest.fn()
const mockShowToast = jest.fn()
const mockGetFileSystemManager = jest.fn()

beforeEach(() => {
  // 重置所有 mock
  mockChooseMessageFile.mockReset()
  mockShowToast.mockReset()
  mockGetFileSystemManager.mockReset()

  // 设置 Taro mock
  ;(Taro as any).chooseMessageFile = mockChooseMessageFile
  ;(Taro as any).showToast = mockShowToast
  ;(Taro as any).getFileSystemManager = mockGetFileSystemManager
})

describe('ResumeUploader 组件', () => {
  test('应该正确渲染组件', () => {
    const onUpload = jest.fn()
    const { container } = render(<ResumeUploader onUpload={onUpload} />)

    // 验证组件渲染
    expect(container.querySelector('textarea')).toBeTruthy()
    expect(container.textContent).toContain('选择文件')
    expect(container.textContent).toContain('支持 .md、.txt 格式')
  })

  test('应该支持文本输入', () => {
    const onUpload = jest.fn()
    const { container } = render(<ResumeUploader onUpload={onUpload} />)

    const textarea = container.querySelector('textarea')
    expect(textarea).toBeTruthy()

    // 模拟文本输入
    const testContent = '# 张三\n\n## 工作经历\n软件工程师'
    fireEvent.input(textarea!, {
      detail: { value: testContent }
    })

    // 验证 onUpload 被调用
    expect(onUpload).toHaveBeenCalledWith(testContent)
  })

  test('应该显示字符计数', () => {
    const onUpload = jest.fn()
    const { container } = render(<ResumeUploader onUpload={onUpload} />)

    const textarea = container.querySelector('textarea')
    const testContent = '测试内容'

    fireEvent.input(textarea!, {
      detail: { value: testContent }
    })

    // 验证字符计数显示
    expect(container.textContent).toContain(`${testContent.length} 字符`)
  })

  test('应该支持清空内容', () => {
    const onUpload = jest.fn()
    const { container } = render(<ResumeUploader onUpload={onUpload} />)

    const textarea = container.querySelector('textarea')

    // 输入内容
    fireEvent.input(textarea!, {
      detail: { value: '测试内容' }
    })

    // 点击清空按钮
    const clearButton = Array.from(container.querySelectorAll('div')).find(
      el => el.textContent === '清空'
    )
    expect(clearButton).toBeTruthy()

    fireEvent.click(clearButton!)

    // 验证内容被清空
    expect(onUpload).toHaveBeenCalledWith('')
  })

  test('应该验证文件类型 - 支持的类型', async () => {
    const onUpload = jest.fn()
    const mockReadFile = jest.fn((options: any) => {
      options.success({ data: '# 简历内容' })
    })

    mockGetFileSystemManager.mockReturnValue({
      readFile: mockReadFile
    })

    mockChooseMessageFile.mockResolvedValue({
      tempFiles: [
        {
          name: 'resume.md',
          path: '/tmp/resume.md',
          size: 1024
        }
      ]
    })

    const { container } = render(<ResumeUploader onUpload={onUpload} />)

    // 点击选择文件按钮
    const uploadButton = Array.from(container.querySelectorAll('div')).find(
      el => el.textContent?.includes('选择文件')
    )
    fireEvent.click(uploadButton!)

    await waitFor(() => {
      expect(mockChooseMessageFile).toHaveBeenCalled()
      expect(mockReadFile).toHaveBeenCalled()
      expect(onUpload).toHaveBeenCalledWith('# 简历内容')
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '文件上传成功',
          icon: 'success'
        })
      )
    })
  })

  test('应该验证文件类型 - 不支持的类型', async () => {
    const onUpload = jest.fn()

    mockChooseMessageFile.mockResolvedValue({
      tempFiles: [
        {
          name: 'resume.pdf',
          path: '/tmp/resume.pdf',
          size: 1024
        }
      ]
    })

    const { container } = render(<ResumeUploader onUpload={onUpload} />)

    // 点击选择文件按钮
    const uploadButton = Array.from(container.querySelectorAll('div')).find(
      el => el.textContent?.includes('选择文件')
    )
    fireEvent.click(uploadButton!)

    await waitFor(() => {
      expect(mockChooseMessageFile).toHaveBeenCalled()
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '不支持的文件类型',
          icon: 'none'
        })
      )
      expect(onUpload).not.toHaveBeenCalled()
    })
  })

  test('应该验证文件大小 - 超过限制', async () => {
    const onUpload = jest.fn()
    const maxSize = 5 // 5MB

    mockChooseMessageFile.mockResolvedValue({
      tempFiles: [
        {
          name: 'resume.md',
          path: '/tmp/resume.md',
          size: 6 * 1024 * 1024 // 6MB
        }
      ]
    })

    const { container } = render(
      <ResumeUploader onUpload={onUpload} maxSize={maxSize} />
    )

    // 点击选择文件按钮
    const uploadButton = Array.from(container.querySelectorAll('div')).find(
      el => el.textContent?.includes('选择文件')
    )
    fireEvent.click(uploadButton!)

    await waitFor(() => {
      expect(mockChooseMessageFile).toHaveBeenCalled()
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: `文件大小超过 ${maxSize}MB`,
          icon: 'none'
        })
      )
      expect(onUpload).not.toHaveBeenCalled()
    })
  })

  test('应该验证文件大小 - 在限制内', async () => {
    const onUpload = jest.fn()
    const maxSize = 5 // 5MB
    const mockReadFile = jest.fn((options: any) => {
      options.success({ data: '# 简历内容' })
    })

    mockGetFileSystemManager.mockReturnValue({
      readFile: mockReadFile
    })

    mockChooseMessageFile.mockResolvedValue({
      tempFiles: [
        {
          name: 'resume.md',
          path: '/tmp/resume.md',
          size: 3 * 1024 * 1024 // 3MB
        }
      ]
    })

    const { container } = render(
      <ResumeUploader onUpload={onUpload} maxSize={maxSize} />
    )

    // 点击选择文件按钮
    const uploadButton = Array.from(container.querySelectorAll('div')).find(
      el => el.textContent?.includes('选择文件')
    )
    fireEvent.click(uploadButton!)

    await waitFor(() => {
      expect(mockChooseMessageFile).toHaveBeenCalled()
      expect(mockReadFile).toHaveBeenCalled()
      expect(onUpload).toHaveBeenCalledWith('# 简历内容')
    })
  })

  test('应该处理文件选择失败', async () => {
    const onUpload = jest.fn()

    mockChooseMessageFile.mockRejectedValue(new Error('用户取消'))

    const { container } = render(<ResumeUploader onUpload={onUpload} />)

    // 点击选择文件按钮
    const uploadButton = Array.from(container.querySelectorAll('div')).find(
      el => el.textContent?.includes('选择文件')
    )
    fireEvent.click(uploadButton!)

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '文件选择失败',
          icon: 'none'
        })
      )
      expect(onUpload).not.toHaveBeenCalled()
    })
  })

  test('应该处理文件读取失败', async () => {
    const onUpload = jest.fn()
    const mockReadFile = jest.fn((options: any) => {
      options.fail(new Error('读取失败'))
    })

    mockGetFileSystemManager.mockReturnValue({
      readFile: mockReadFile
    })

    mockChooseMessageFile.mockResolvedValue({
      tempFiles: [
        {
          name: 'resume.md',
          path: '/tmp/resume.md',
          size: 1024
        }
      ]
    })

    const { container } = render(<ResumeUploader onUpload={onUpload} />)

    // 点击选择文件按钮
    const uploadButton = Array.from(container.querySelectorAll('div')).find(
      el => el.textContent?.includes('选择文件')
    )
    fireEvent.click(uploadButton!)

    await waitFor(() => {
      expect(mockReadFile).toHaveBeenCalled()
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '文件选择失败',
          icon: 'none'
        })
      )
    })
  })

  test('应该支持自定义 acceptTypes', () => {
    const onUpload = jest.fn()
    const customTypes = ['.md', '.txt', '.doc']

    const { container } = render(
      <ResumeUploader onUpload={onUpload} acceptTypes={customTypes} />
    )

    // 验证提示信息包含自定义类型
    expect(container.textContent).toContain('.md、.txt、.doc')
  })

  test('应该支持自定义 maxSize', () => {
    const onUpload = jest.fn()
    const customMaxSize = 10

    const { container } = render(
      <ResumeUploader onUpload={onUpload} maxSize={customMaxSize} />
    )

    // 验证提示信息包含自定义大小
    expect(container.textContent).toContain(`最大 ${customMaxSize}MB`)
  })

  test('应该支持自定义 placeholder', () => {
    const onUpload = jest.fn()
    const customPlaceholder = '请输入您的简历...'

    const { container } = render(
      <ResumeUploader onUpload={onUpload} placeholder={customPlaceholder} />
    )

    const textarea = container.querySelector('textarea')
    expect(textarea?.getAttribute('placeholder')).toBe(customPlaceholder)
  })

  test('应该支持初始值', () => {
    const onUpload = jest.fn()
    const initialValue = '# 初始简历内容'

    const { container } = render(
      <ResumeUploader onUpload={onUpload} value={initialValue} />
    )

    const textarea = container.querySelector('textarea')
    expect(textarea?.textContent).toBe(initialValue)
  })

  test('应该显示错误信息', async () => {
    const onUpload = jest.fn()

    mockChooseMessageFile.mockResolvedValue({
      tempFiles: [
        {
          name: 'resume.exe',
          path: '/tmp/resume.exe',
          size: 1024
        }
      ]
    })

    const { container } = render(<ResumeUploader onUpload={onUpload} />)

    // 点击选择文件按钮
    const uploadButton = Array.from(container.querySelectorAll('div')).find(
      el => el.textContent?.includes('选择文件')
    )
    fireEvent.click(uploadButton!)

    await waitFor(() => {
      // 验证错误信息显示
      expect(container.textContent).toContain('不支持的文件类型')
    })
  })

  test('应该在输入新内容时清除错误', async () => {
    const onUpload = jest.fn()

    mockChooseMessageFile.mockResolvedValue({
      tempFiles: [
        {
          name: 'resume.exe',
          path: '/tmp/resume.exe',
          size: 1024
        }
      ]
    })

    const { container } = render(<ResumeUploader onUpload={onUpload} />)

    // 触发错误
    const uploadButton = Array.from(container.querySelectorAll('div')).find(
      el => el.textContent?.includes('选择文件')
    )
    fireEvent.click(uploadButton!)

    await waitFor(() => {
      expect(container.textContent).toContain('不支持的文件类型')
    })

    // 输入新内容
    const textarea = container.querySelector('textarea')
    fireEvent.input(textarea!, {
      detail: { value: '新内容' }
    })

    // 验证错误消失
    await waitFor(() => {
      expect(container.textContent).not.toContain('不支持的文件类型')
    })
  })
})
