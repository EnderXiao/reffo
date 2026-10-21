export type ReferenceTimelineSoundKind = 'line' | 'month' | 'travel' | 'fine' | 'close'

type AudioContextConstructor = typeof AudioContext

const SOUND_VARIANTS: Record<ReferenceTimelineSoundKind, {
  pitch: number
  decay: number
  level: number
  clear?: number
}> = {
  line: {pitch: 1, decay: 1, level: 1},
  month: {pitch: 0.88, decay: 1.2, level: 1.1},
  travel: {pitch: 1.08, decay: 0.8, level: 0.5},
  fine: {pitch: 1.5, decay: 0.7, level: 0.55},
  close: {pitch: 1.2, decay: 0.85, level: 0.4, clear: 0.07},
}

export class ReferenceTimelineAudio {
  private context: AudioContext | null = null
  private buffers = new Map<ReferenceTimelineSoundKind, AudioBuffer>()
  private resumeRetries = 0
  private lastResumeAt = -Infinity
  private nextAvailableAt = 0
  private queued: {kind: ReferenceTimelineSoundKind; level: number} | null = null
  private queueTimer: number | null = null
  private lastContext: AudioContext | null = null
  private lastTravelIndex = -1

  unlock = () => {
    if (typeof window === 'undefined') {
      return
    }
    const AudioContextClass = (
      window.AudioContext
      || (window as Window & {webkitAudioContext?: AudioContextConstructor}).webkitAudioContext
    ) as AudioContextConstructor | undefined
    if (!AudioContextClass) {
      return
    }

    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContextClass()
      this.lastContext = this.context
      this.buffers.clear()
      this.resumeRetries = 0
      this.context.addEventListener('statechange', () => {
        if (this.context?.state === 'running' && this.lastContext === this.context) {
          this.resumeRetries = 0
        }
      })
    }

    if (this.context.state === 'running') {
      this.resumeRetries = 0
      return
    }

    const now = performance.now()
    if (now - this.lastResumeAt > 600) {
      this.lastResumeAt = now
      this.resumeRetries += 1
    }
    void this.context.resume().catch(() => undefined)
  }

  play = (kind: ReferenceTimelineSoundKind, level = 1, each = false) => {
    this.unlock()
    const context = this.context
    if (!context) {
      return
    }
    if (context.state !== 'running') {
      this.queued = {kind, level}
      return
    }

    const variant = SOUND_VARIANTS[kind]
    const now = context.currentTime
    if (each) {
      const scheduled = Math.max(now, this.nextAvailableAt)
      if (scheduled - now > 0.25) {
        return
      }
      this.nextAvailableAt = scheduled + 0.02
      this.emit(context, kind, level, scheduled)
      return
    }

    if (variant.clear) {
      this.queued = null
    } else if (now < this.nextAvailableAt) {
      this.queued = {kind, level}
      if (this.queueTimer == null) {
        this.queueTimer = window.setTimeout(() => {
          this.queueTimer = null
          const queued = this.queued
          this.queued = null
          if (queued) {
            this.play(queued.kind, queued.level)
          }
        }, Math.max(1, (this.nextAvailableAt - now) * 1000 + 1))
      }
      return
    }

    const scheduledAt = Math.max(now, variant.clear ? this.nextAvailableAt + variant.clear : now)
    this.nextAvailableAt = scheduledAt + Math.max(0.06, variant.clear ?? 0)
    this.emit(context, kind, level, scheduledAt)
  }

  playTravel = (index: number, level = 1) => {
    if (index === this.lastTravelIndex) {
      return
    }
    const distance = Math.abs(index - this.lastTravelIndex)
    this.lastTravelIndex = index
    this.play('travel', distance > 1 ? level * 0.75 : level, true)
  }

  dispose = () => {
    if (this.queueTimer != null) {
      window.clearTimeout(this.queueTimer)
      this.queueTimer = null
    }
    this.queued = null
    this.buffers.clear()
    if (this.context && this.context.state !== 'closed') {
      void this.context.close().catch(() => undefined)
    }
    this.context = null
    this.lastContext = null
  }

  private emit(context: AudioContext, kind: ReferenceTimelineSoundKind, level: number, scheduledAt: number) {
    const source = context.createBufferSource()
    const gain = context.createGain()
    const variant = SOUND_VARIANTS[kind]
    source.buffer = this.getBuffer(context, kind)
    source.playbackRate.value = 1 + (Math.random() - 0.5) * 0.04
    gain.gain.value = 0.2 * variant.level * level
    source.connect(gain).connect(context.destination)
    source.start(scheduledAt)
  }

  private getBuffer(context: AudioContext, kind: ReferenceTimelineSoundKind) {
    const cached = this.buffers.get(kind)
    if (cached) {
      return cached
    }

    const variant = SOUND_VARIANTS[kind]
    const duration = 0.25 * variant.decay
    const frameCount = Math.max(1, Math.round(context.sampleRate * duration))
    const buffer = context.createBuffer(1, frameCount, context.sampleRate)
    const channel = buffer.getChannelData(0)
    const highpass = 4000 * variant.pitch
    const partials: Array<[frequency: number, decay: number, level: number]> = [
      [5200 * variant.pitch, 0.8 * variant.decay, 0.6],
      [7400 * variant.pitch, 0.5 * variant.decay, 0.4],
    ]
    const filterState = {m: 0, h: 0, v: 0, y: 0}
    const omega = 2 * Math.PI * highpass / context.sampleRate
    const cosine = Math.cos(omega)
    const sine = Math.sin(omega) / Math.SQRT2
    const b0 = (1 + cosine) / 2
    const b1 = -(1 + cosine)
    const b2 = (1 + cosine) / 2
    const a0 = 1 + sine
    const a1 = -2 * cosine
    const a2 = 1 - sine

    for (let frame = 0; frame < frameCount; frame += 1) {
      const progress = frame / context.sampleRate
      const random = Math.random() * 2 - 1
      const filtered = (
        b0 * random + b1 * filterState.m + b2 * filterState.h - a1 * filterState.v - a2 * filterState.y
      ) / a0
      filterState.h = filterState.m
      filterState.m = random
      filterState.y = filterState.v
      filterState.v = filtered
      let sample = 0.5 * filtered * Math.exp(-progress / (0.25 * variant.decay / 1000)) * 3
      for (const [frequency, decay, level] of partials) {
        sample += level * Math.sin(2 * Math.PI * frequency * progress) * Math.exp(-progress / decay)
      }
      channel[frame] = sample * Math.min(1, progress / 0.0001)
    }

    const fadeFrames = Math.max(1, Math.round(context.sampleRate * 0.005))
    for (let frame = 0; frame < fadeFrames; frame += 1) {
      channel[frameCount - 1 - frame] *= frame / fadeFrames
    }
    let peak = 0
    for (const sample of channel) {
      peak = Math.max(peak, Math.abs(sample))
    }
    if (peak > 0) {
      for (let frame = 0; frame < frameCount; frame += 1) {
        channel[frame] /= peak
      }
    }

    this.buffers.set(kind, buffer)
    return buffer
  }
}
