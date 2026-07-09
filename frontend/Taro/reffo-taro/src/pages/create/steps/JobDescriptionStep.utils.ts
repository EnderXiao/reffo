export function readInputValue(event: any) {
  return event?.detail?.value ?? event?.target?.value ?? ''
}
