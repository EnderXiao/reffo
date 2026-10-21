let writeQueue = Promise.resolve()

/** Serialize Harness writes across all request-local PersistenceSubscriber instances. */
export function enqueueHarnessWrite<T>(operation: () => T | Promise<T>): Promise<T> {
  const result = writeQueue.then(operation)
  writeQueue = result.then(() => undefined, () => undefined)
  return result
}

export function resetHarnessWriteQueueForTests() {
  writeQueue = Promise.resolve()
}
