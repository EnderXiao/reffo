import {useEffect, useState} from 'react'

export type VisualTier = 'basic' | 'enhanced' | 'premium'

export interface VisualCapabilitySnapshot {
  tier: VisualTier
  initialTier?: VisualTier
  renderMode?: 'css-basic' | 'css-enhanced' | 'three'
  downgradeReason?: string
  upgradeReason?: string
  overrideReason?: string
  decisionTrace?: string[]
  supportsBackdropFilter: boolean
  supportsWebGL: boolean
  supportsWebGL2: boolean
  prefersReducedMotion: boolean
  hardwareConcurrency: number
  deviceMemory: number | null
  averageFrameMs?: number
  longFrameCount?: number
}

const DEFAULT_SNAPSHOT: VisualCapabilitySnapshot = {
  tier: 'basic',
  supportsBackdropFilter: false,
  supportsWebGL: false,
  supportsWebGL2: false,
  prefersReducedMotion: false,
  hardwareConcurrency: 2,
  deviceMemory: null,
}

let cachedSnapshot: VisualCapabilitySnapshot | null = null
let pendingSnapshot: Promise<VisualCapabilitySnapshot> | null = null
let hasLoggedSnapshot = false

function canUseDOM() {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function supportsContext(contextName: 'webgl' | 'webgl2') {
  if (!canUseDOM()) {
    return false
  }

  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext(contextName, {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    } as WebGLContextAttributes))
  } catch {
    return false
  }
}

function getDeviceMemory() {
  if (!canUseDOM()) {
    return null
  }

  const navigatorWithMemory = navigator as Navigator & {deviceMemory?: number}
  return typeof navigatorWithMemory.deviceMemory === 'number'
    ? navigatorWithMemory.deviceMemory
    : null
}

function normalizeVisualTier(value: string | null | undefined): VisualTier | null {
  return value === 'basic' || value === 'enhanced' || value === 'premium' ? value : null
}

function getVisualTierOverride(): VisualTier | null {
  if (!canUseDOM()) {
    return null
  }

  try {
    const params = new URLSearchParams(window.location.search)
    return normalizeVisualTier(params.get('visualTier') || params.get('reffoVisualTier'))
      || normalizeVisualTier(window.localStorage?.getItem('reffo.visualTier'))
  } catch {
    return null
  }
}

export function detectVisualTierSync(): VisualCapabilitySnapshot {
  if (!canUseDOM()) {
    return DEFAULT_SNAPSHOT
  }

  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  const cssSupports = typeof CSS !== 'undefined' ? CSS.supports : undefined
  const supportsBackdropFilter = cssSupports?.('backdrop-filter', 'blur(12px)')
    || cssSupports?.('-webkit-backdrop-filter', 'blur(12px)')
    || false
  const supportsWebGL = supportsContext('webgl')
  const supportsWebGL2 = supportsContext('webgl2')
  const hardwareConcurrency = navigator.hardwareConcurrency || 2
  const deviceMemory = getDeviceMemory()
  const overrideTier = getVisualTierOverride()
  const decisionTrace = [
    `webgl2=${supportsWebGL2}`,
    `cores=${hardwareConcurrency}`,
    `memory=${deviceMemory ?? 'unknown'}`,
    `backdrop=${supportsBackdropFilter}`,
    `reducedMotion=${prefersReducedMotion}`,
  ]

  if (overrideTier) {
    return {
      tier: overrideTier,
      overrideReason: 'url-or-localStorage',
      decisionTrace: [...decisionTrace, `override=${overrideTier}`],
      supportsBackdropFilter,
      supportsWebGL,
      supportsWebGL2,
      prefersReducedMotion,
      hardwareConcurrency,
      deviceMemory,
    }
  }

  if (prefersReducedMotion) {
    return {
      tier: 'basic',
      decisionTrace: [...decisionTrace, 'tier=basic:reduced-motion'],
      supportsBackdropFilter,
      supportsWebGL,
      supportsWebGL2,
      prefersReducedMotion,
      hardwareConcurrency,
      deviceMemory,
    }
  }

  const memoryAllowsPremium = deviceMemory == null || deviceMemory >= 4
  const tier: VisualTier = supportsWebGL2 && hardwareConcurrency >= 6 && memoryAllowsPremium
    ? 'premium'
    : supportsBackdropFilter && hardwareConcurrency >= 4
      ? 'enhanced'
      : 'basic'
  const tierReason = tier === 'premium'
    ? 'tier=premium:sync-capability'
    : tier === 'enhanced'
      ? 'tier=enhanced:css-capability'
      : 'tier=basic:min-capability'

  return {
    tier,
    decisionTrace: [...decisionTrace, tierReason],
    supportsBackdropFilter,
    supportsWebGL,
    supportsWebGL2,
    prefersReducedMotion,
    hardwareConcurrency,
    deviceMemory,
  }
}

export function measureFrameBudget(duration = 450) {
  if (!canUseDOM()) {
    return Promise.resolve({averageFrameMs: 33, longFrameCount: 1})
  }

  return new Promise<{averageFrameMs: number; longFrameCount: number}>(resolve => {
    const frames: number[] = []
    let last = performance.now()
    const start = last

    function tick(now: number) {
      frames.push(now - last)
      last = now

      if (now - start >= duration) {
        const averageFrameMs = frames.reduce((sum, frame) => sum + frame, 0) / Math.max(frames.length, 1)
        const longFrameCount = frames.filter(frame => frame > 24).length
        resolve({averageFrameMs, longFrameCount})
        return
      }

      window.requestAnimationFrame(tick)
    }

    window.requestAnimationFrame(tick)
  })
}

function downgradeByFrameBudget(snapshot: VisualCapabilitySnapshot) {
  if (snapshot.overrideReason) {
    return snapshot
  }

  if (snapshot.prefersReducedMotion) {
    return {
      ...snapshot,
      tier: 'basic' as VisualTier,
      downgradeReason: 'prefers-reduced-motion',
      decisionTrace: [...(snapshot.decisionTrace || []), 'downgrade=basic:reduced-motion'],
    }
  }

  const averageFrameMs = snapshot.averageFrameMs ?? 16
  const longFrameCount = snapshot.longFrameCount ?? 0

  if (snapshot.tier === 'premium' && (averageFrameMs > 19 || longFrameCount >= 4)) {
    return {
      ...snapshot,
      tier: 'enhanced' as VisualTier,
      downgradeReason: `frame-budget avg=${averageFrameMs.toFixed(1)}ms long=${longFrameCount}`,
      decisionTrace: [...(snapshot.decisionTrace || []), 'downgrade=enhanced:slow-premium-frame-budget'],
    }
  }

  if (snapshot.tier === 'enhanced' && (averageFrameMs > 24 || longFrameCount >= 6)) {
    return {
      ...snapshot,
      tier: 'basic' as VisualTier,
      downgradeReason: `frame-budget avg=${averageFrameMs.toFixed(1)}ms long=${longFrameCount}`,
      decisionTrace: [...(snapshot.decisionTrace || []), 'downgrade=basic:slow-enhanced-frame-budget'],
    }
  }

  return snapshot
}

function resolveBenchmarkTier(snapshot: VisualCapabilitySnapshot) {
  if (snapshot.overrideReason) {
    return snapshot
  }

  const averageFrameMs = snapshot.averageFrameMs ?? 33
  const longFrameCount = snapshot.longFrameCount ?? 99
  const memoryIsKnownLow = snapshot.deviceMemory != null && snapshot.deviceMemory < 4
  const canPromoteToPremium = !snapshot.prefersReducedMotion
    && snapshot.supportsWebGL2
    && snapshot.hardwareConcurrency >= 4
    && !memoryIsKnownLow
    && averageFrameMs <= 18.5
    && longFrameCount <= 3

  if (snapshot.tier !== 'premium' && canPromoteToPremium) {
    return {
      ...snapshot,
      tier: 'premium' as VisualTier,
      upgradeReason: `benchmark avg=${averageFrameMs.toFixed(1)}ms long=${longFrameCount}`,
      downgradeReason: undefined,
      decisionTrace: [...(snapshot.decisionTrace || []), 'upgrade=premium:benchmark'],
    }
  }

  return downgradeByFrameBudget({
    ...snapshot,
    decisionTrace: [
      ...(snapshot.decisionTrace || []),
      canPromoteToPremium ? 'benchmark=premium-capable' : 'benchmark=no-promotion',
    ],
  })
}

function withRenderMode(snapshot: VisualCapabilitySnapshot): VisualCapabilitySnapshot {
  const renderMode = snapshot.tier === 'premium'
    ? 'three'
    : snapshot.tier === 'enhanced'
      ? 'css-enhanced'
      : 'css-basic'

  return {
    ...snapshot,
    renderMode,
  }
}

export function logVisualTier(snapshot: VisualCapabilitySnapshot, scope = 'global') {
  if (!canUseDOM()) {
    return
  }

  const logger = console.info || console.log
  logger('[Reffo visual-tier]', {
    scope,
    tier: snapshot.tier,
    renderMode: snapshot.renderMode,
    initialTier: snapshot.initialTier,
    downgradeReason: snapshot.downgradeReason || 'none',
    upgradeReason: snapshot.upgradeReason || 'none',
    overrideReason: snapshot.overrideReason || 'none',
    supportsBackdropFilter: snapshot.supportsBackdropFilter,
    supportsWebGL: snapshot.supportsWebGL,
    supportsWebGL2: snapshot.supportsWebGL2,
    prefersReducedMotion: snapshot.prefersReducedMotion,
    hardwareConcurrency: snapshot.hardwareConcurrency,
    deviceMemory: snapshot.deviceMemory,
    averageFrameMs: snapshot.averageFrameMs,
    longFrameCount: snapshot.longFrameCount,
    decisionTrace: snapshot.decisionTrace,
  })
}

export async function resolveVisualTier(options: {forceRefresh?: boolean; benchmark?: boolean} = {}) {
  if (cachedSnapshot && !options.forceRefresh) {
    return cachedSnapshot
  }

  if (pendingSnapshot && !options.forceRefresh) {
    return pendingSnapshot
  }

  pendingSnapshot = (async () => {
    const initialSnapshot = detectVisualTierSync()
    const initialTier = initialSnapshot.tier

    if (!options.benchmark || initialSnapshot.tier === 'basic') {
      cachedSnapshot = withRenderMode({
        ...initialSnapshot,
        initialTier,
      })
      if (!hasLoggedSnapshot) {
        logVisualTier(cachedSnapshot)
        hasLoggedSnapshot = true
      }
      pendingSnapshot = null
      return cachedSnapshot
    }

    const frameBudget = await measureFrameBudget()
    cachedSnapshot = withRenderMode(resolveBenchmarkTier({
      ...initialSnapshot,
      initialTier,
      ...frameBudget,
    }))
    if (!hasLoggedSnapshot) {
      logVisualTier(cachedSnapshot)
      hasLoggedSnapshot = true
    }
    pendingSnapshot = null
    return cachedSnapshot
  })()

  return pendingSnapshot
}

export function useVisualTier(options: {benchmark?: boolean} = {}) {
  const [snapshot, setSnapshot] = useState<VisualCapabilitySnapshot>(() => cachedSnapshot || detectVisualTierSync())

  useEffect(() => {
    let cancelled = false

    resolveVisualTier({benchmark: options.benchmark}).then(nextSnapshot => {
      if (!cancelled) {
        setSnapshot(nextSnapshot)
      }
    })

    return () => {
      cancelled = true
    }
  }, [options.benchmark])

  return snapshot
}
