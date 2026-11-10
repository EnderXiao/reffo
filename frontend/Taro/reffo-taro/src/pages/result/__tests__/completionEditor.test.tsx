import {useState} from 'react'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {serializeDraft, type ResumeCompletionDocument} from '@/shared/resume-completion'
import {ResumePanel} from '../components/ResumePanel.h5'
import {completionFixture, completionResult} from './completionFixture'

function Harness({commit = async () => undefined, onDocument}: {commit?: () => Promise<void>; onDocument?: (doc: ResumeCompletionDocument) => void}) {
  const [result, setResult] = useState(completionResult())
  return <ResumePanel result={result} companyName='测试公司' positionName='产品经理'
    onOptimizedResumeChange={async () => undefined}
    onCompletionDocumentChange={async doc => {
      setResult(current => ({...current, optimized: {...current.optimized, completion_document: doc, optimized_resume: serializeDraft(doc)}}))
      onDocument?.(doc)
      await commit()
    }} />
}

describe('相契简历原位填写', () => {
  test('候选只填草稿，保存仅替换目标空位且保留局部编辑', async () => {
    const onDocument = jest.fn()
    render(<Harness onDocument={onDocument} />)
    fireEvent.click(screen.getByRole('button', {name: '填写实际交付名称'}))
    expect(screen.getByLabelText('实际交付名称')).toBeTruthy()
    expect(screen.getByText('填实际交付的设计产物名称。补明具体产出。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', {name: '页面原型'}))
    expect(onDocument).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', {name: '保存'}))
    await waitFor(() => expect(screen.getByRole('button', {name: '修改实际交付名称'}).textContent).toBe('页面原型'))
    const doc = onDocument.mock.calls[0][0] as ResumeCompletionDocument
    expect(doc.blocks[0].segments[0]).toEqual(completionFixture().blocks[0].segments[0])
    expect(doc.blocks[0].segments[2]).toEqual(completionFixture().blocks[0].segments[2])
    expect(doc.revision).toBe(1)
    expect(screen.queryByText('还有 1 处待补')).toBeNull()
  })

  test('保存失败保留输入，重试不重复增加版本', async () => {
    const commit = jest.fn().mockRejectedValueOnce(new Error('磁盘写入失败')).mockResolvedValue(undefined)
    const onDocument = jest.fn()
    render(<Harness commit={commit} onDocument={onDocument} />)
    fireEvent.click(screen.getByRole('button', {name: '填写实际交付名称'}))
    fireEvent.change(screen.getByLabelText('实际交付名称'), {target: {value: '交互原型'}})
    fireEvent.click(screen.getByRole('button', {name: '保存'}))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('未保存，可重试'))
    expect((screen.getByLabelText('实际交付名称') as HTMLInputElement).value).toBe('交互原型')
    fireEvent.click(screen.getByRole('button', {name: '保存'}))
    await waitFor(() => expect(screen.queryByLabelText('实际交付名称')).toBeNull())
    expect(onDocument.mock.calls.map(call => call[0].revision)).toEqual([1, 1])
  })

  test.each(['不补充，移除补充分句', '保存'])('移除失败后通过“%s”重试原提交并保留撤销', async retryLabel => {
    const commit = jest.fn().mockRejectedValueOnce(new Error('磁盘写入失败')).mockResolvedValue(undefined)
    const onDocument = jest.fn()
    render(<Harness commit={commit} onDocument={onDocument} />)
    fireEvent.click(screen.getByRole('button', {name: '填写实际交付名称'}))
    fireEvent.click(screen.getByRole('button', {name: '不补充，移除补充分句'}))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('未保存，可重试'))
    fireEvent.click(screen.getByRole('button', {name: retryLabel}))
    await waitFor(() => expect(screen.queryByLabelText('实际交付名称')).toBeNull())
    expect(onDocument.mock.calls.map(call => call[0].revision)).toEqual([1, 1])
    expect(serializeDraft(onDocument.mock.calls[1][0])).toBe('- 参与需求梳理，支持评审。')
    fireEvent.click(screen.getByRole('button', {name: '撤销移除'}))
    await waitFor(() => expect(screen.getByRole('button', {name: '填写实际交付名称'})).toBeTruthy())
  })

  test('多行编辑失败后修改草稿，重新提交替换完整原编辑范围', async () => {
    const commit = jest.fn().mockRejectedValueOnce(new Error('磁盘写入失败')).mockResolvedValue(undefined)
    const onDocument = jest.fn()
    render(<Harness commit={commit} onDocument={onDocument} />)
    fireEvent.click(screen.getByRole('button', {name: '修改第 1 行'}))
    fireEvent.change(screen.getByLabelText('修改整行简历'), {target: {value: '- 已编辑 A。\n- 已编辑 B。'}})
    fireEvent.click(screen.getByRole('button', {name: '保存整行'}))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('未保存，可重试'))
    fireEvent.change(screen.getByLabelText('修改整行简历'), {target: {value: '- 已编辑 A。\n- 改为 C。'}})
    fireEvent.click(screen.getByRole('button', {name: '保存整行'}))
    await waitFor(() => expect(screen.queryByLabelText('修改整行简历')).toBeNull())
    expect(onDocument.mock.calls.map(call => call[0].revision)).toEqual([1, 2])
    expect(serializeDraft(onDocument.mock.calls[1][0])).toBe('- 已编辑 A。\n- 改为 C。')
  })

  test('失败提交后取消也遇到写入失败，重试取消保存同一回退稿', async () => {
    const commit = jest.fn().mockRejectedValueOnce(new Error('磁盘写入失败'))
      .mockRejectedValueOnce(new Error('磁盘仍不可用')).mockResolvedValue(undefined)
    const onDocument = jest.fn()
    render(<Harness commit={commit} onDocument={onDocument} />)
    fireEvent.click(screen.getByRole('button', {name: '填写实际交付名称'}))
    fireEvent.change(screen.getByLabelText('实际交付名称'), {target: {value: '交互原型'}})
    fireEvent.click(screen.getByRole('button', {name: '保存'}))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('未保存，可重试'))
    fireEvent.click(screen.getByRole('button', {name: '取消'}))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('取消未保存成功'))
    fireEvent.click(screen.getByRole('button', {name: '取消'}))
    await waitFor(() => expect(screen.queryByLabelText('实际交付名称')).toBeNull())
    expect(onDocument.mock.calls.map(call => call[0].revision)).toEqual([1, 2, 2])
    expect(screen.getByRole('button', {name: '填写实际交付名称'})).toBeTruthy()
  })

  test('取消丢弃输入；移除完整补充分句并可撤销', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', {name: '填写实际交付名称'}))
    fireEvent.change(screen.getByLabelText('实际交付名称'), {target: {value: '未保存内容'}})
    fireEvent.click(screen.getByRole('button', {name: '取消'}))
    expect(screen.getByRole('button', {name: '填写实际交付名称'})).toBeTruthy()
    fireEvent.click(screen.getByRole('button', {name: '填写实际交付名称'}))
    fireEvent.click(screen.getByRole('button', {name: '不补充，移除补充分句'}))
    await waitFor(() => expect(screen.queryByLabelText('实际交付名称')).toBeNull())
    expect(screen.queryByText('，交付设计产物')).toBeNull()
    fireEvent.click(screen.getByRole('button', {name: '撤销移除'}))
    await waitFor(() => expect(screen.getByRole('button', {name: '填写实际交付名称'})).toBeTruthy())
  })

  test('撤销写入失败时保留重试入口，不被新编辑覆盖', async () => {
    const commit = jest.fn().mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('磁盘写入失败')).mockResolvedValue(undefined)
    const onDocument = jest.fn()
    render(<Harness commit={commit} onDocument={onDocument} />)
    fireEvent.click(screen.getByRole('button', {name: '填写实际交付名称'}))
    fireEvent.click(screen.getByRole('button', {name: '不补充，移除补充分句'}))
    await waitFor(() => expect(screen.queryByLabelText('实际交付名称')).toBeNull())
    fireEvent.click(screen.getByRole('button', {name: '撤销移除'}))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('撤销未保存'))
    fireEvent.click(screen.getByRole('button', {name: '填写实际交付名称'}))
    expect(screen.queryByLabelText('实际交付名称')).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('请先重试保存撤销操作')
    fireEvent.click(screen.getByRole('button', {name: '撤销移除'}))
    await waitFor(() => expect(screen.queryByRole('button', {name: '撤销移除'})).toBeNull())
    expect(onDocument.mock.calls.map(call => call[0].revision)).toEqual([1, 2, 2])
  })

  test('整行只删除短标记时清理完整可选分句', async () => {
    const onDocument = jest.fn()
    render(<Harness onDocument={onDocument} />)
    fireEvent.click(screen.getByRole('button', {name: '修改第 1 行'}))
    const input = screen.getByLabelText('修改整行简历') as HTMLTextAreaElement
    fireEvent.change(input, {target: {value: input.value.replace(/〔待补[^〕]+〕/u, '')}})
    fireEvent.click(screen.getByRole('button', {name: '保存整行'}))
    await waitFor(() => expect(screen.queryByLabelText('修改整行简历')).toBeNull())
    expect(serializeDraft(onDocument.mock.calls[0][0])).toBe('- 参与需求梳理，支持评审。')
  })

  test('组合输入的 Enter 不保存，空白保存仍为待填', async () => {
    const onDocument = jest.fn()
    render(<Harness onDocument={onDocument} />)
    fireEvent.click(screen.getByRole('button', {name: '填写实际交付名称'}))
    const input = screen.getByLabelText('实际交付名称')
    fireEvent.compositionStart(input)
    fireEvent.change(input, {target: {value: '原型'}})
    fireEvent.keyDown(input, {key: 'Enter', isComposing: true})
    expect(onDocument).not.toHaveBeenCalled()
    fireEvent.compositionEnd(input)
    fireEvent.change(input, {target: {value: '   '}})
    fireEvent.click(screen.getByRole('button', {name: '保存'}))
    await waitFor(() => expect(screen.queryByLabelText('实际交付名称')).toBeNull())
    expect(screen.getByText('还有 1 处待补')).toBeTruthy()
  })

  test('下载清理副本但不改在线文档，编辑时禁止下载', async () => {
    const createObjectURL = jest.fn((_blob: Blob) => 'blob:resume')
    Object.defineProperty(URL, 'createObjectURL', {configurable: true, value: createObjectURL})
    Object.defineProperty(URL, 'revokeObjectURL', {configurable: true, value: jest.fn()})
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', {name: '填写实际交付名称'}))
    fireEvent.click(screen.getByRole('button', {name: '下载'}))
    expect(createObjectURL).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', {name: '取消'}))
    fireEvent.click(screen.getByRole('button', {name: '下载'}))
    const blob = createObjectURL.mock.calls[0][0] as Blob
    const content = await new Promise<string>(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(blob)
    })
    expect(content).toBe('- 参与需求梳理，支持评审。')
    expect(screen.getByRole('button', {name: '填写实际交付名称'})).toBeTruthy()
    expect(click).toHaveBeenCalledTimes(1)
    click.mockRestore()
  })
})
