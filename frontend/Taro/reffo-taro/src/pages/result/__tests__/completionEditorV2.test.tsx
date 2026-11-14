import {resumeExportApi} from '@/services/resumeExport'
import {useState} from 'react'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {COMPLETION_TEMPLATES, createCompletionDocument, findGap, prepareResumeExport, replayCompletionOperation,
  serializeDraft, type CompletionOperation, type ResumeCompletionDocument, type ResumeDependentClaim,
  type ResumeRequiredDetailGap} from '@/shared/resume-completion'
import {ResumePanel} from '../components/ResumePanel.h5'
import {completionResult} from './completionFixture'

function fixture() {
  const templates = ['metric_definition', 'metric_period', 'metric_population'] as const
  const fields = templates.map((template, index): ResumeRequiredDetailGap => ({kind: 'required_detail_gap',
    gapId: `gap-${index}`, detailId: `detail-${index}`, template, ...COMPLETION_TEMPLATES[template], candidates: [], fill: {state: 'empty'}}))
  const claim: ResumeDependentClaim = {kind: 'dependent_claim', claimId: 'claim', sourceEvidenceIds: ['e1'],
    sourceSpans: [{sourceBlockId: 'source', start: 0, end: 15}], readiness: 'metadata_missing', qualifiers: ['原材料记录'],
    parts: [{kind: 'text', segmentId: 'claim-text', markdown: '，原材料记录有效率95%', origin: 'generated'}, ...fields,
      {kind: 'text', segmentId: 'claim-end', markdown: '。', origin: 'generated'}], requiredGapIds: fields.map(field => field.gapId), fillPolicy: 'all_required'}
  return createCompletionDocument({schemaVersion: 'resume-completion-v2', documentId: 'v2-ui', blocks: [{blockId: 'row', kind: 'bullet', prefix: '- ',
    segments: [{kind: 'text', segmentId: 'known', markdown: '完成四类能力设计', origin: 'generated'}, claim]}]})
}

type Submission = {document: ResumeCompletionDocument; operations: CompletionOperation[]}
function Harness({initial = fixture(), commit = async () => undefined, onDocument}: {
  initial?: ResumeCompletionDocument
  commit?: () => Promise<void>
  onDocument?: (submission: Submission) => void
}) {
  const [result, setResult] = useState(() => completionResult(initial))
  return <ResumePanel result={result} companyName='测试公司' positionName='产品经理'
    prepareDownload={async () => ({historyId: 'saved', documentId: result.optimized.completion_document!.documentId, revision: result.optimized.completion_document!.revision})}
    onOptimizedResumeChange={async () => undefined}
    onCompletionDocumentChange={async (document, _baseRevision, _baseMarkdown, operation) => {
      setResult(current => ({...current, optimized: {...current.optimized, completion_document: document, optimized_resume: serializeDraft(document)}}))
      onDocument?.({document, operations: operation ? Array.isArray(operation) ? operation : [operation] : []})
      await commit()
    }} />
}

async function saveField(label: string, value: string, filled = false) {
  fireEvent.click(screen.getByRole('button', {name: `${filled ? '修改' : '填写'}${label}`}))
  fireEvent.change(screen.getByLabelText(label), {target: {value}})
  fireEvent.click(screen.getByRole('button', {name: '保存'}))
  await waitFor(() => expect(screen.queryByLabelText(label)).toBeNull())
}

function replay(base: ResumeCompletionDocument, submission: Submission) {
  let current = base
  for (const operation of submission.operations) {
    const result = replayCompletionOperation(current, operation)
    if (!result.ok) throw new Error(JSON.stringify(result.issues))
    current = result.document
  }
  expect(current).toEqual(submission.document)
  return current
}

describe('相契简历 v2 关联结果原位编辑', () => {
  test('三个必要字段原位可见，部分填写不放行数字，全部填写后可导出', async () => {
    const submissions: Submission[] = []
    const initial = fixture()
    render(<Harness initial={initial} onDocument={submission => submissions.push(submission)} />)
    expect(screen.getByText('还有 3 处待补')).toBeTruthy()
    expect(screen.queryByText('口径仍待补充，下载时将省略此项结果。')).toBeNull()
    await saveField('指标定义', '店长评价通过')
    expect(prepareResumeExport(submissions.at(-1)!.document)).toMatchObject({ok: true, markdown: '- 完成四类能力设计', omittedClaimCount: 1})
    await saveField('统计周期', '2026年8月')
    await saveField('统计对象', '试点门店')
    expect(screen.queryByText('口径仍待补充，下载时将省略此项结果。')).toBeNull()
    expect(prepareResumeExport(submissions.at(-1)!.document)).toMatchObject({ok: true, omittedClaimCount: 0})
    let current = initial
    for (const submission of submissions) current = replay(current, submission)
  })

  test('清空与不补充使关联结果退出下载，撤销恢复原字段', async () => {
    const submissions: Submission[] = []
    render(<Harness onDocument={submission => submissions.push(submission)} />)
    await saveField('指标定义', '店长评价通过')
    await saveField('统计周期', '2026年8月')
    await saveField('统计对象', '试点门店')
    await saveField('统计周期', '', true)
    expect(prepareResumeExport(submissions.at(-1)!.document)).toMatchObject({ok: true, omittedClaimCount: 1})
    expect(findGap(submissions.at(-1)!.document, 'gap-0')?.fill).toMatchObject({state: 'filled'})
    fireEvent.click(screen.getByRole('button', {name: '修改指标定义'}))
    fireEvent.click(screen.getByRole('button', {name: '不补充，下载时省略关联结果'}))
    await waitFor(() => expect(screen.queryByLabelText('指标定义')).toBeNull())
    expect(screen.getByRole('button', {name: '填写指标定义'})).toBeTruthy()
    fireEvent.click(screen.getByRole('button', {name: '撤销移除'}))
    await waitFor(() => expect(screen.getByRole('button', {name: '修改指标定义'})).toBeTruthy())
    expect(prepareResumeExport(submissions.at(-1)!.document)).toMatchObject({ok: true, omittedClaimCount: 1})
  })

  test('整行仅删除必要标记仍保留依赖，不能下载原数字', async () => {
    const submissions: Submission[] = []
    render(<Harness onDocument={submission => submissions.push(submission)} />)
    fireEvent.click(screen.getByRole('button', {name: '修改第 1 行'}))
    const input = screen.getByLabelText('修改整行简历') as HTMLTextAreaElement
    fireEvent.change(input, {target: {value: input.value.replace(/〔待补[^〕]+〕/u, '')}})
    fireEvent.click(screen.getByRole('button', {name: '保存整行'}))
    await waitFor(() => expect(screen.queryByLabelText('修改整行简历')).toBeNull())
    expect(prepareResumeExport(submissions.at(-1)!.document)).toMatchObject({ok: true, markdown: '- 完成四类能力设计', omittedClaimCount: 1})
    expect(screen.getByRole('button', {name: '填写指标定义'})).toBeTruthy()
    replay(fixture(), submissions[0])
  })

  test('缺少依赖的部分改写被原编辑器阻止，完整改写记录为用户文本', async () => {
    const submissions: Submission[] = []
    render(<Harness onDocument={submission => submissions.push(submission)} />)
    fireEvent.click(screen.getByRole('button', {name: '修改第 1 行'}))
    const input = screen.getByLabelText('修改整行简历')
    fireEvent.change(input, {target: {value: '- 完成四类能力设计，有效率95%。'}})
    fireEvent.click(screen.getByRole('button', {name: '保存整行'}))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('无法确认必要口径'))
    expect(submissions).toHaveLength(0)
    fireEvent.change(input, {target: {value: '- 完成调研与方案设计。'}})
    fireEvent.click(screen.getByRole('button', {name: '保存整行'}))
    await waitFor(() => expect(screen.queryByLabelText('修改整行简历')).toBeNull())
    expect(submissions[0].document.blocks[0].segments).toContainEqual(expect.objectContaining({origin: 'user', replacedClaimIds: ['claim']}))
    replay(fixture(), submissions[0])
  })

  test('相同失败提交重试不增加版本，操作可从原稿重放', async () => {
    const commit = jest.fn().mockRejectedValueOnce(new Error('磁盘失败')).mockResolvedValue(undefined)
    const submissions: Submission[] = []
    render(<Harness commit={commit} onDocument={submission => submissions.push(submission)} />)
    fireEvent.click(screen.getByRole('button', {name: '填写指标定义'}))
    fireEvent.change(screen.getByLabelText('指标定义'), {target: {value: '店长评价通过'}})
    fireEvent.click(screen.getByRole('button', {name: '保存'}))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('未保存，可重试'))
    fireEvent.click(screen.getByRole('button', {name: '保存'}))
    await waitFor(() => expect(screen.queryByLabelText('指标定义')).toBeNull())
    expect(submissions.map(submission => submission.document.revision)).toEqual([1, 1])
    expect(submissions[0]).toEqual(submissions[1])
    replay(fixture(), submissions[1])
  })

  test('失败后改稿通过原操作反演再应用新稿，重放结果一致', async () => {
    const commit = jest.fn().mockRejectedValueOnce(new Error('磁盘失败')).mockResolvedValue(undefined)
    const submissions: Submission[] = []
    const initial = fixture()
    render(<Harness initial={initial} commit={commit} onDocument={submission => submissions.push(submission)} />)
    fireEvent.click(screen.getByRole('button', {name: '填写指标定义'}))
    fireEvent.change(screen.getByLabelText('指标定义'), {target: {value: '初始口径'}})
    fireEvent.click(screen.getByRole('button', {name: '保存'}))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('未保存，可重试'))
    fireEvent.change(screen.getByLabelText('指标定义'), {target: {value: '修订口径'}})
    fireEvent.click(screen.getByRole('button', {name: '保存'}))
    await waitFor(() => expect(screen.queryByLabelText('指标定义')).toBeNull())
    expect(submissions.map(submission => submission.document.revision)).toEqual([1, 3])
    const first = replay(initial, submissions[0])
    const next = replay(first, submissions[1])
    expect(findGap(next, 'gap-0')?.fill).toEqual({state: 'filled', value: '修订口径', origin: 'user'})
  })

  test('失败后取消可验证恢复，取消保存重试不会重复增加版本', async () => {
    const commit = jest.fn().mockRejectedValueOnce(new Error('磁盘失败'))
      .mockRejectedValueOnce(new Error('磁盘仍不可用')).mockResolvedValue(undefined)
    const submissions: Submission[] = []
    const initial = fixture()
    render(<Harness initial={initial} commit={commit} onDocument={submission => submissions.push(submission)} />)
    fireEvent.click(screen.getByRole('button', {name: '填写指标定义'}))
    fireEvent.change(screen.getByLabelText('指标定义'), {target: {value: '尚未保存的口径'}})
    fireEvent.click(screen.getByRole('button', {name: '保存'}))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('未保存，可重试'))
    fireEvent.click(screen.getByRole('button', {name: '取消'}))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('取消未保存成功'))
    fireEvent.click(screen.getByRole('button', {name: '取消'}))
    await waitFor(() => expect(screen.queryByLabelText('指标定义')).toBeNull())
    expect(submissions.map(submission => submission.document.revision)).toEqual([1, 2, 2])
    expect(submissions[1]).toEqual(submissions[2])
    replay(replay(initial, submissions[0]), submissions[2])
    expect(findGap(submissions[2].document, 'gap-0')?.fill).toEqual({state: 'empty'})
  })

  test('以当前保存版本请求 PDF，保留在线草稿和已填口径', async () => {
    const createObjectURL = jest.fn((_blob: Blob) => 'blob:completion-v2')
    Object.defineProperty(URL, 'createObjectURL', {configurable: true, value: createObjectURL})
    Object.defineProperty(URL, 'revokeObjectURL', {configurable: true, value: jest.fn()})
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const create = jest.spyOn(resumeExportApi, 'create').mockImplementation(async target => ({export_id: 'export-test', status: 'ready',
      document_id: target.documentId, revision: target.revision, disposition: 'application_ready', reason_codes: [],
      file_name: '测试用户_学校_产品经理.pdf', omitted_count: 0, omitted_claim_count: 1, download_path: '/authenticated-file'}))
    const file = jest.spyOn(resumeExportApi, 'file').mockResolvedValue(new Uint8Array([37, 80, 68, 70, 45]).buffer)

    const submissions: Submission[] = []
    render(<Harness onDocument={submission => submissions.push(submission)} />)
    await saveField('指标定义', '店长评价通过')
    fireEvent.click(screen.getByRole('button', {name: '下载'}))
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    const blob = createObjectURL.mock.calls[0][0]
    expect(blob.type).toBe('application/pdf')
    expect(create).toHaveBeenCalledWith({historyId: 'saved', documentId: 'v2-ui', revision: 1}, expect.any(String))
    expect(screen.getByRole('button', {name: '修改指标定义'}).textContent).toBe('店长评价通过')
    expect(serializeDraft(submissions[0].document)).toContain('95%')
    expect(screen.getByRole('button', {name: '填写统计周期'})).toBeTruthy()
    click.mockRestore()
    create.mockRestore()
    file.mockRestore()
  })

  test('损坏 v2 只显示原稿，禁止整行编辑与下载降级', () => {
    const initial = fixture()
    initial.markdownFingerprint = '损坏指纹'
    const createObjectURL = jest.fn()
    Object.defineProperty(URL, 'createObjectURL', {configurable: true, value: createObjectURL})
    render(<Harness initial={initial} />)
    expect(screen.queryByRole('button', {name: '修改第 1 行'})).toBeNull()
    expect(screen.queryByRole('button', {name: '填写指标定义'})).toBeNull()
    fireEvent.click(screen.getByRole('button', {name: '下载'}))
    expect(createObjectURL).not.toHaveBeenCalled()
  })
})
