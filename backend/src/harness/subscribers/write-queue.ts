const writeQueues = new Map<string, Promise<void>>()

/** Serialize writes for one run while allowing independent runs to persist concurrently. */
export function enqueueHarnessWrite<T>(operation: () => T | Promise<T>, queueKey = 'default'): Promise<T> {
  const previous = writeQueues.get(queueKey) ?? Promise.resolve()
  const result = previous.then(operation)
  writeQueues.set(queueKey, result.then(() => undefined, () => undefined))
  return result
}

export function resetHarnessWriteQueueForTests() {
  writeQueues.clear()
}
