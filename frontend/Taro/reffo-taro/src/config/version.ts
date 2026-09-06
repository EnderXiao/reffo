const rawVersion = typeof process !== 'undefined' ? process.env.REFFO_VERSION : undefined
const rawDescription = typeof process !== 'undefined' ? process.env.REFFO_RELEASE_NOTES : undefined

export const appVersion = rawVersion && /^v?\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/.test(rawVersion)
  ? `V${rawVersion.replace(/^v/i, '')}`
  : 'V1.0.0'

export const appReleaseNotes = rawDescription?.trim() || '首次公开版本'
