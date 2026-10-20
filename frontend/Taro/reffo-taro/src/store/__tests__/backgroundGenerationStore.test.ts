import {beforeEach, describe, expect, jest, test} from '@jest/globals'
import type {GenerationTask} from '@/services/backgroundGeneration'
import {generationTasksApi} from '@/services/backgroundGeneration'
import {useBackgroundGenerationStore} from '../backgroundGenerationStore'

jest.mock('@/services/backgroundGeneration', () => ({
  generationTasksApi: {
    list: jest.fn(),
    create: jest.fn(),
    get: jest.fn(),
    action: jest.fn(),
  },
}))

const listMock = generationTasksApi.list as jest.MockedFunction<typeof generationTasksApi.list>

function createTask(overrides: Partial<GenerationTask> = {}): GenerationTask {
  return {
    id: 'task-1',
    status: 'completed',
    stage: 'saving',
    background: true,
    read_at: null,
    confirmed_at: null,
    history_id: 'JD-task-1',
    error: null,
    created_at: '2026-10-14T00:00:00.000Z',
    updated_at: '2026-10-14T00:01:00.000Z',
    company: 'Reffo',
    position: '产品经理',
    location: '上海',
    score: 88,
    ...overrides,
  }
}

describe('backgroundGenerationStore', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    useBackgroundGenerationStore.getState().reset()
  })

  test('快照遗漏已完成任务时保留任务卡来源', async () => {
    const completed = createTask({
      id: 'task-completed',
      confirmed_at: '2026-10-14T00:02:00.000Z',
      updated_at: '2026-10-14T00:02:00.000Z',
    })
    const running = createTask({
      id: 'task-running',
      status: 'running',
      history_id: null,
      created_at: '2026-10-14T00:03:00.000Z',
      updated_at: '2026-10-14T00:03:00.000Z',
    })
    useBackgroundGenerationStore.setState({tasks: [completed, running]})
    listMock.mockResolvedValue([running])

    await useBackgroundGenerationStore.getState().refresh()

    expect(useBackgroundGenerationStore.getState().tasks.map(task => task.id)).toEqual([
      'task-running',
      'task-completed',
    ])
  })
})
