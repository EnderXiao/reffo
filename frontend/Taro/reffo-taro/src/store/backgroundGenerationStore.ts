import {create} from 'zustand'
import {generationTasksApi, type GenerationTask} from '@/services/backgroundGeneration'

interface BackgroundGenerationState {
  tasks: GenerationTask[]
  error: string | null
  refresh: () => Promise<void>
  upsert: (task: GenerationTask) => void
  reset: () => void
}

let epoch = 0
let refreshPromise: Promise<void> | null = null

function mergeGenerationTasks(primary: GenerationTask[], fallback: GenerationTask[]) {
  const taskMap = new Map<string, GenerationTask>()
  fallback.forEach(task => taskMap.set(task.id, task))
  primary.forEach(task => {
    const existing = taskMap.get(task.id)
    taskMap.set(task.id, existing && existing.updated_at > task.updated_at ? existing : task)
  })
  return Array.from(taskMap.values())
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
}

export const useBackgroundGenerationStore = create<BackgroundGenerationState>((set, get) => ({
  tasks: [],
  error: null,
  refresh: () => {
    if (refreshPromise) return refreshPromise
    const startedEpoch = epoch
    refreshPromise = generationTasksApi.list().then(tasks => {
      if (startedEpoch !== epoch) return
      const current = get().tasks
      const incomingIds = new Set(tasks.map(task => task.id))
      const retainedCompletedTasks = current.filter(task => (
        task.status === 'completed' && task.history_id && !incomingIds.has(task.id)
      ))
      set({tasks: mergeGenerationTasks([...tasks, ...retainedCompletedTasks], current), error: null})
    }).catch(error => {
      if (startedEpoch === epoch) set({error: error instanceof Error ? error.message : '生成状态暂时不可用'})
    }).finally(() => {
      if (startedEpoch === epoch) refreshPromise = null
    })
    return refreshPromise
  },
  upsert: task => set(state => {
    const existing = state.tasks.find(item => item.id === task.id)
    if (existing && existing.updated_at > task.updated_at) {
      return state
    }

    return {tasks: mergeGenerationTasks([task], state.tasks)}
  }),
  reset: () => {epoch += 1; refreshPromise = null; set({tasks: [], error: null})},
}))
