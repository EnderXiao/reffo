import React from 'react'
import { render, fireEvent } from '@testing-library/react'
import { JDInput } from '../index'

describe('JDInput 组件', () => {
  describe('基础渲染', () => {
    test('应该正确渲染组件', () => {
      const onChange = jest.fn()
      const { container } = render(<JDInput onChange={onChange} />)
      
      expect(container.querySelector('textarea')).toBeTruthy()
    })

    test('应该显示默认占位符', () => {
      const onChange = jest.fn()
      const { getByPlaceholderText } = render(<JDInput onChange={onChange} />)
      
      expect(getByPlaceholderText('请输入或粘贴 JD 内容...')).toBeTruthy()
    })

    test('应该显示自定义占位符', () => {
      const onChange = jest.fn()
      const customPlaceholder = '请输入岗位描述'
      const { getByPlaceholderText } = render(
        <JDInput onChange={onChange} placeholder={customPlaceholder} />
      )
      
      expect(getByPlaceholderText(customPlaceholder)).toBeTruthy()
    })

    test('应该显示初始值', () => {
      const onChange = jest.fn()
      const initialValue = '岗位职责：负责产品开发'
      const { container } = render(
        <JDInput onChange={onChange} value={initialValue} />
      )
      
      const textarea = container.querySelector('textarea')
      expect(textarea?.value).toBe(initialValue)
    })
  })

  describe('文本输入', () => {
    test('应该在输入时调用 onChange', () => {
      const onChange = jest.fn()
      const { container } = render(<JDInput onChange={onChange} />)
      
      const textarea = container.querySelector('textarea')
      const testValue = '测试 JD 内容'
      
      // 使用标准的 change 事件，mock 会转换为 Taro 格式
      fireEvent.change(textarea!, { target: { value: testValue } })
      
      expect(onChange).toHaveBeenCalledWith(testValue)
    })

    test('应该更新内部状态', () => {
      const onChange = jest.fn()
      const { container } = render(<JDInput onChange={onChange} />)
      
      const textarea = container.querySelector('textarea')
      const testValue = '测试内容'
      
      // 使用标准的 change 事件
      fireEvent.change(textarea!, { target: { value: testValue } })
      
      // 验证 onChange 被调用
      expect(onChange).toHaveBeenCalledWith(testValue)
    })
  })

  describe('字数统计', () => {
    test('应该显示字数统计', () => {
      const onChange = jest.fn()
      const testValue = '测试内容'
      const { getByText } = render(
        <JDInput onChange={onChange} value={testValue} />
      )
      
      expect(getByText(/4/)).toBeTruthy() // "测试内容" 有 4 个字符
    })

    test('应该显示字数限制', () => {
      const onChange = jest.fn()
      const maxLength = 1000
      const { getByText } = render(
        <JDInput onChange={onChange} maxLength={maxLength} />
      )
      
      expect(getByText(`0 / ${maxLength}`)).toBeTruthy()
    })

    test('应该在接近限制时显示警告样式', () => {
      const onChange = jest.fn()
      const maxLength = 100
      const testValue = 'a'.repeat(85) // 85% 的限制
      const { container } = render(
        <JDInput onChange={onChange} value={testValue} maxLength={maxLength} />
      )
      
      const charCountText = container.querySelector('.charCountText')
      expect(charCountText?.classList.contains('nearLimit')).toBe(true)
    })

    test('应该在超出限制时显示错误样式', () => {
      const onChange = jest.fn()
      const maxLength = 100
      const testValue = 'a'.repeat(101)
      const { container, getByText } = render(
        <JDInput onChange={onChange} value={testValue} maxLength={maxLength} />
      )
      
      const charCountText = container.querySelector('.charCountText')
      expect(charCountText?.classList.contains('overLimit')).toBe(true)
      expect(getByText(/内容已超出字数限制/)).toBeTruthy()
    })
  })

  describe('清空功能', () => {
    test('应该在有内容时显示清空按钮', () => {
      const onChange = jest.fn()
      const { getByText } = render(
        <JDInput onChange={onChange} value="测试内容" />
      )
      
      expect(getByText('清空')).toBeTruthy()
    })

    test('应该在无内容时隐藏清空按钮', () => {
      const onChange = jest.fn()
      const { queryByText } = render(<JDInput onChange={onChange} />)
      
      expect(queryByText('清空')).toBeNull()
    })

    test('应该在点击清空按钮时清空内容', () => {
      const onChange = jest.fn()
      const { getByText, container } = render(
        <JDInput onChange={onChange} value="测试内容" />
      )
      
      const clearButton = getByText('清空')
      fireEvent.click(clearButton)
      
      expect(onChange).toHaveBeenCalledWith('')
      const textarea = container.querySelector('textarea')
      expect(textarea?.value).toBe('')
    })
  })

  describe('提示信息', () => {
    test('应该显示使用提示', () => {
      const onChange = jest.fn()
      const { getByText } = render(<JDInput onChange={onChange} />)
      
      expect(getByText(/建议包含：岗位职责、任职要求、优先条件等关键信息/)).toBeTruthy()
    })
  })

  describe('自定义样式', () => {
    test('应该支持自定义 className', () => {
      const onChange = jest.fn()
      const customClass = 'custom-jd-input'
      const { container } = render(
        <JDInput onChange={onChange} className={customClass} />
      )
      
      const jdInput = container.querySelector('.jdInput')
      expect(jdInput?.classList.contains(customClass)).toBe(true)
    })
  })

  describe('边界情况', () => {
    test('应该处理空字符串', () => {
      const onChange = jest.fn()
      const { container } = render(<JDInput onChange={onChange} value="" />)
      
      const textarea = container.querySelector('textarea')
      expect(textarea?.value).toBe('')
    })

    test('应该处理非常长的文本', () => {
      const onChange = jest.fn()
      const longText = 'a'.repeat(10000)
      const { container } = render(
        <JDInput onChange={onChange} value={longText} />
      )
      
      const textarea = container.querySelector('textarea')
      expect(textarea?.value).toBe(longText)
    })

    test('应该处理特殊字符', () => {
      const onChange = jest.fn()
      const specialText = '岗位职责：\n1. 负责开发\n2. 代码审查\n\n要求：\n- 3年经验\n- 熟悉 React'
      const { container } = render(
        <JDInput onChange={onChange} value={specialText} />
      )
      
      const textarea = container.querySelector('textarea')
      expect(textarea?.value).toBe(specialText)
    })
  })

  describe('Requirement 4.7 验证', () => {
    test('应该实现多行文本输入', () => {
      const onChange = jest.fn()
      const { container } = render(<JDInput onChange={onChange} />)
      
      const textarea = container.querySelector('textarea')
      expect(textarea).toBeTruthy()
      expect(textarea?.tagName.toLowerCase()).toBe('textarea')
    })

    test('应该实现字数统计功能', () => {
      const onChange = jest.fn()
      const testValue = '测试 JD 内容'
      const { container } = render(
        <JDInput onChange={onChange} value={testValue} />
      )
      
      const charCount = container.querySelector('.charCount')
      expect(charCount).toBeTruthy()
      expect(charCount?.textContent).toContain(testValue.length.toString())
    })

    test('应该支持字数限制配置', () => {
      const onChange = jest.fn()
      const maxLength = 5000
      const { getByText } = render(
        <JDInput onChange={onChange} maxLength={maxLength} />
      )
      
      expect(getByText(`0 / ${maxLength}`)).toBeTruthy()
    })

    test('应该在超出限制时给出提示', () => {
      const onChange = jest.fn()
      const maxLength = 10
      const testValue = 'a'.repeat(15)
      const { getByText } = render(
        <JDInput onChange={onChange} value={testValue} maxLength={maxLength} />
      )
      
      expect(getByText(/内容已超出字数限制/)).toBeTruthy()
    })
  })
})
