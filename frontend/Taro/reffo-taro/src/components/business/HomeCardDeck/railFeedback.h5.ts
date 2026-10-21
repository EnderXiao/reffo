export type DictionaryRailSoundKind = 'step' | 'travel' | 'fine' | 'close'

type AudioContextConstructor = typeof AudioContext

const SOUND_SETTINGS: Record<DictionaryRailSoundKind, {
  duration: number
  highpass: number
  level: number
  partials: [frequency: number, decay: number, level: number][]
}> = {
  step: {
    duration: 0.075,
    highpass: 4200,
    level: 0.22,
    partials: [[5200, 0.42, 0.42], [7400, 0.3, 0.25]],
  },
  travel: {
    duration: 0.055,
    highpass: 4800,
    level: 0.12,
    partials: [[5600, 0.32, 0.3], [8200, 0.22, 0.18]],
  },
  fine: {
    duration: 0.06,
    highpass: 5200,
    level: 0.13,
    partials: [[6800, 0.28, 0.34], [9100, 0.2, 0.16]],
  },
  close: {
    duration: 0.095,
    highpass: 3800,
    level: 0.16,
    partials: [[4600, 0.5, 0.36], [6200, 0.36, 0.22]],
  },
}

export class DictionaryRailFeedback {
  private context: AudioContext | null = null
  private buffers = new Map<DictionaryRailSoundKind, AudioBuffer>()
  private lastPlayedAt = 0
  private disposed = false

  unlock = () => {
    if (this.disposed || typeof window === 'undefined') {
      return
    }

    const AudioContextClass = (window.AudioContext || (window as Window & {webkitAudioContext?: AudioContextConstructor}).webkitAudioContext) as AudioContextConstructor | undefined
    if (!AudioContextClass) {
      return
    }

    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContextClass()
      this.buffers.clear()
    }

    if (this.context.state === 'suspended') {
      void this.context.resume().catch(() => undefined)
    }
  }

  play = (kind: DictionaryRailSoundKind, intensity = 1) => {
    if (this.disposed) {
      return
    }

    this.unlock()
    const context = this.context
    if (!context || context.state !== 'running') {
      return
    }

    const now = performance.now()
    const minimumGap = kind === 'travel' ? 36 : 52
    if (now - this.lastPlayedAt < minimumGap) {
      return
    }

    this.lastPlayedAt = now
    const source = context.createBufferSource()
    const gain = context.createGain()
    const filter = context.createBiquadFilter()
    const settings = SOUND_SETTINGS[kind]

    source.buffer = this.getBuffer(context, kind)
    source.playbackRate.value = 1 + (Math.random() - 0.5) * 0.04
    filter.type = 'highpass'
    filter.frequency.value = settings.highpass
    gain.gain.value = settings.level * Math.min(1.4, Math.max(0.35, intensity))
    source.connect(filter).connect(gain).connect(context.destination)
    source.start()
  }

  dispose = () => {
    this.disposed = true
    this.buffers.clear()
    if (this.context && this.context.state !== 'closed') {
      void this.context.close().catch(() => undefined)
    }
    this.context = null
  }

  private getBuffer(context: AudioContext, kind: DictionaryRailSoundKind) {
    const cached = this.buffers.get(kind)
    if (cached) {
      return cached
    }

    const settings = SOUND_SETTINGS[kind]
    const frameCount = Math.max(1, Math.round(context.sampleRate * settings.duration))
    const buffer = context.createBuffer(1, frameCount, context.sampleRate)
    const channel = buffer.getChannelData(0)
    const decayFrames = Math.max(1, frameCount * 0.22)

    for (let frame = 0; frame < frameCount; frame += 1) {
      const time = frame / context.sampleRate
      const progress = frame / frameCount
      let sample = (Math.random() * 2 - 1) * Math.exp(-progress * 8)

      for (const [frequency, decay, level] of settings.partials) {
        sample += Math.sin(2 * Math.PI * frequency * time) * Math.exp(-time / decay) * level
      }

      channel[frame] = sample * Math.min(1, frame / 32) * Math.min(1, (frameCount - frame) / decayFrames)
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
