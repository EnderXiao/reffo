function rollTransform(angle: number) {
  return `perspective(3em) translateZ(-0.54em) rotateX(${angle}deg) translateZ(0.54em)`
}

function opacityForAngle(angle: number) {
  return Math.max(0, 1 - Math.abs(angle) / 64) ** 1.5
}

function rollText(element: HTMLElement, nextText: string, direction: number, duration = 360) {
  if (element.textContent === nextText) {
    return
  }
  if (direction === 0 || typeof element.animate !== 'function') {
    element.textContent = nextText
    return
  }

  const previous = element.cloneNode(true) as HTMLElement
  previous.setAttribute('aria-hidden', 'true')
  previous.style.position = 'absolute'
  previous.style.left = '0'
  previous.style.top = '0'
  previous.style.height = '100%'
  element.parentElement?.append(previous)
  element.textContent = nextText

  const angles = Array.from({length: 25}, (_, index) => {
    const progress = index / 24
    return -direction * 64 * progress
  })
  const incomingAngles = angles.map(angle => -angle)
  const common = {duration, fill: 'both' as const}
  const outgoing = previous.animate(
    angles.map(angle => ({transform: rollTransform(angle), opacity: opacityForAngle(angle)})),
    common,
  )
  const incoming = element.animate(
    incomingAngles.map(angle => ({transform: rollTransform(angle), opacity: opacityForAngle(angle)})),
    common,
  )
  void Promise.all([outgoing.finished, incoming.finished]).then(
    () => previous.remove(),
    () => previous.remove(),
  )
}

export function updateTimelineDate(root: HTMLElement, date: Date, locale: string, direction: number) {
  const parts = new Intl.DateTimeFormat(locale, {month: 'short', day: 'numeric'}).formatToParts(date)
  const dayIndex = parts.findIndex(part => part.type === 'day')
  const join = (items: Intl.DateTimeFormatPart[]) => items.map(item => item.value).join('')
  const values = [
    join(parts.slice(0, dayIndex)),
    dayIndex >= 0 && parts[dayIndex].value.length > 1 ? parts[dayIndex].value.slice(0, -1) : '',
    dayIndex >= 0 ? parts[dayIndex].value.slice(-1) : '',
    join(parts.slice(dayIndex + 1)),
  ]
  const reels = Array.from(root.querySelectorAll<HTMLElement>('[data-timeline-reel] > span, [data-timeline-reel] > taro-text-core'))
  values.forEach((value, index) => {
    const reel = reels[index]
    if (reel) {
      rollText(reel, value, direction, index === 1 || index === 2 ? 360 : 520)
    }
  })
}

export function resetTimelineDate(root: HTMLElement, date: Date, locale: string) {
  root.querySelectorAll('[data-timeline-reel] > span, [data-timeline-reel] > taro-text-core').forEach(element => {
    element.textContent = ''
  })
  updateTimelineDate(root, date, locale, 0)
}
