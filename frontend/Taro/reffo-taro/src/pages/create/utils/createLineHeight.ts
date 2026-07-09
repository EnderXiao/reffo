export function createLineHeight(value: number) {
  const isWebRuntime =
    process.env.TARO_ENV === 'h5' ||
    (typeof window !== 'undefined' && typeof document !== 'undefined')

  return isWebRuntime ? `${value}px` : value
}
