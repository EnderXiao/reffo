export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function lerp(from: number, to: number, progress: number) {
  return from + (to - from) * progress
}

export function exponentialApproach(current: number, target: number, elapsedMs: number, timeConstantMs: number) {
  return current + (target - current) * (1 - Math.exp(-elapsedMs / timeConstantMs))
}

export function gaussian(value: number, radius: number) {
  return Math.exp(-(value * value) / (radius * radius))
}

export function edgeFade(value: number) {
  return Math.pow(Math.max(0, 1 - value), 1.5)
}

export function rubberBand(value: number, limit: number) {
  const magnitude = Math.abs(value)
  if (magnitude === 0 || limit <= 0) {
    return 0
  }
  const scale = 0.55
  return Math.sign(value) * (scale * magnitude * limit) / (limit + scale * magnitude)
}

export function clampEndpointTargets(targets: number[], maximum: number) {
  if (targets.length === 0) {
    return
  }

  let leading = 0
  while (leading < targets.length && targets[leading] < 0) {
    leading += 1
  }
  let trailing = targets.length - 1
  while (trailing >= 0 && targets[trailing] > maximum) {
    trailing -= 1
  }

  if (leading > trailing) {
    for (let index = 0; index < targets.length; index += 1) {
      targets[index] = targets.length > 1 ? maximum * (index / (targets.length - 1)) : 0
    }
    return
  }

  for (let index = 0; index < leading; index += 1) {
    targets[index] = targets[leading] * (index / leading)
  }
  for (let index = trailing + 1; index < targets.length; index += 1) {
    targets[index] = lerp(targets[trailing], maximum, (index - trailing) / (targets.length - 1 - trailing))
  }
}

export function interpolateIndex(positions: number[], value: number) {
  if (positions.length < 2) {
    return 0
  }
  if (value <= positions[0]) {
    return 0
  }

  for (let index = 0; index < positions.length - 1; index += 1) {
    if (value <= positions[index + 1]) {
      const span = positions[index + 1] - positions[index]
      return index + (span > 1e-6 ? (value - positions[index]) / span : 0)
    }
  }

  return positions.length - 1
}

export function samplePositions(positions: number[], value: number) {
  if (positions.length === 0) {
    return 0
  }
  const normalized = clamp(value, 0, positions.length - 1)
  const lower = Math.floor(normalized)
  const upper = Math.min(positions.length - 1, lower + 1)
  return lerp(positions[lower], positions[upper], normalized - lower)
}

export function visibleRatio(itemLeft: number, itemWidth: number, scrollLeft: number, viewportWidth: number) {
  const left = itemLeft - scrollLeft
  return clamp((Math.min(left + itemWidth, viewportWidth) - Math.max(left, 0)) / Math.max(1, itemWidth), 0, 1)
}

export function smoothstep(value: number) {
  const normalized = clamp(value, 0, 1)
  return normalized * normalized * (3 - 2 * normalized)
}

export function cubicBezierProgress(progress: number, from: number, to: number, initialVelocity: number, duration: number) {
  const t = clamp(progress, 0, 1)
  const t2 = t * t
  const t3 = t2 * t
  const velocity = initialVelocity * duration
  return {
    progress: t,
    position: (2 * t3 - 3 * t2 + 1) * from + (t3 - 2 * t2 + t) * velocity + (3 * t2 - 2 * t3) * to,
    velocity: ((6 * t2 - 6 * t) * from + (3 * t2 - 4 * t + 1) * velocity + (6 * t - 6 * t2) * to) / duration,
  }
}
