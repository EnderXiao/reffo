/** Start the next item when a worker frees up. On failure drain all active work
 * before throwing; no dangling calls can outlive budget/checkpoint cleanup. */
export async function boundedMap<T, R>(items: readonly T[], concurrency: number,
  execute: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('INVALID_CONCURRENCY')
  const results: R[] = new Array(items.length)
  const errors: Array<{ index: number; error: unknown }> = []
  let next = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!errors.length && next < items.length) {
      const index = next++
      try { results[index] = await execute(items[index], index) }
      catch (error) { errors.push({ index, error }) }
    }
  }))
  if (errors.length) throw errors.sort((a, b) => a.index - b.index)[0].error
  return results
}
