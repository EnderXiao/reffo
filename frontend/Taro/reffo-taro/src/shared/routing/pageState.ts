export type PageState<T extends string, P extends Record<string, unknown> = Record<string, never>> =
  | ({kind: T} & P)

export function isPageState<T extends string>(
  state: PageState<T> | null | undefined,
  kind: T,
): state is PageState<T> {
  return state?.kind === kind
}
