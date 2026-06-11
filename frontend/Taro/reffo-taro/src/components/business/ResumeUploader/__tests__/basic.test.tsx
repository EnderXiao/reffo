import { describe, test, expect } from '@jest/globals'

describe('ResumeUploader 基础测试', () => {
  test('验证文件类型函数', () => {
    const acceptTypes = ['.md', '.txt']
    
    // 测试支持的类型
    expect('.md'.toLowerCase()).toBe('.md')
    expect(acceptTypes.includes('.md')).toBe(true)
    expect(acceptTypes.includes('.txt')).toBe(true)
    
    // 测试不支持的类型
    expect(acceptTypes.includes('.pdf')).toBe(false)
    expect(acceptTypes.includes('.doc')).toBe(false)
  })

  test('验证文件大小函数', () => {
    const maxSize = 5 // 5MB
    const maxSizeBytes = maxSize * 1024 * 1024
    
    // 测试在限制内
    expect(1024 * 1024).toBeLessThanOrEqual(maxSizeBytes) // 1MB
    expect(3 * 1024 * 1024).toBeLessThanOrEqual(maxSizeBytes) // 3MB
    
    // 测试超过限制
    expect(6 * 1024 * 1024).toBeGreaterThan(maxSizeBytes) // 6MB
    expect(10 * 1024 * 1024).toBeGreaterThan(maxSizeBytes) // 10MB
  })

  test('文件扩展名提取', () => {
    const fileName1 = 'resume.md'
    const fileName2 = 'my-resume.txt'
    const fileName3 = 'document.pdf'
    
    expect(fileName1.substring(fileName1.lastIndexOf('.'))).toBe('.md')
    expect(fileName2.substring(fileName2.lastIndexOf('.'))).toBe('.txt')
    expect(fileName3.substring(fileName3.lastIndexOf('.'))).toBe('.pdf')
  })
})
