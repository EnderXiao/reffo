export const DICTIONARY_RAIL_MINOR_STEPS = 5

export type DictionaryRailStopKind = 'major' | 'minor'

export interface DictionaryRailStop {
  kind: DictionaryRailStopKind
  label: string
  majorIndex: number
  minorIndex: number
  position: number
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function smoothstep(value: number) {
  const normalized = clamp(value, 0, 1)
  return normalized * normalized * (3 - 2 * normalized)
}

export function exponentialApproach(current: number, target: number, elapsedMs: number, timeConstantMs = 48) {
  if (elapsedMs <= 0) {
    return current
  }

  return current + (target - current) * (1 - Math.exp(-elapsedMs / timeConstantMs))
}

export function rubberBand(value: number, min: number, max: number, limit = 1.2) {
  if (value > max) {
    return max + Math.min(limit, (value - max) * 0.32)
  }

  if (value < min) {
    return min - Math.min(limit, (min - value) * 0.32)
  }

  return value
}

export function buildDictionaryRailStops(
  labels: string[],
  minorSteps = DICTIONARY_RAIL_MINOR_STEPS,
  secondaryLabels: string[] = [],
) {
  if (labels.length === 0) {
    return []
  }

  const stops: DictionaryRailStop[] = []

  labels.forEach((label, majorIndex) => {
    if (majorIndex > 0) {
      for (let minorIndex = 1; minorIndex <= minorSteps; minorIndex += 1) {
        stops.push({
          kind: 'minor',
          label: secondaryLabels[majorIndex - 1] || labels[majorIndex - 1],
          majorIndex: majorIndex - 1,
          minorIndex,
          position: majorIndex * (minorSteps + 1) - minorSteps + minorIndex - 1,
        })
      }
    }

    stops.push({
      kind: 'major',
      label,
      majorIndex,
      minorIndex: 0,
      position: majorIndex * (minorSteps + 1),
    })
  })

  return stops
}

export function majorPosition(majorIndex: number, minorSteps = DICTIONARY_RAIL_MINOR_STEPS) {
  return majorIndex * (minorSteps + 1)
}

export function majorIndexFromPosition(position: number, itemCount: number, minorSteps = DICTIONARY_RAIL_MINOR_STEPS) {
  if (itemCount <= 1) {
    return 0
  }

  return clamp(Math.round(position / (minorSteps + 1)), 0, itemCount - 1)
}

export function nearestStopPosition(position: number, itemCount: number, minorSteps = DICTIONARY_RAIL_MINOR_STEPS) {
  if (itemCount <= 1) {
    return 0
  }

  return clamp(Math.round(position), 0, (itemCount - 1) * (minorSteps + 1))
}

export function positionFromRatio(ratio: number, itemCount: number, minorSteps = DICTIONARY_RAIL_MINOR_STEPS) {
  return rubberBand(ratio * (itemCount - 1) * (minorSteps + 1), 0, (itemCount - 1) * (minorSteps + 1))
}

export function ratioFromPosition(position: number, itemCount: number, minorSteps = DICTIONARY_RAIL_MINOR_STEPS) {
  const maximum = (itemCount - 1) * (minorSteps + 1)
  return maximum <= 0 ? 0 : clamp(position / maximum, 0, 1)
}

export function signedIndexDelta(from: number, to: number, itemCount: number) {
  if (itemCount <= 1) {
    return 0
  }

  const direct = to - from
  if (Math.abs(direct) <= itemCount / 2) {
    return direct
  }

  return direct > 0 ? direct - itemCount : direct + itemCount
}
