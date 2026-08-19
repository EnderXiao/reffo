import presets from './landing-presets.json'

export type LandingPresetJobId = keyof typeof presets

export function isLandingPresetJobId(value: unknown): value is LandingPresetJobId {
  return typeof value === 'string' && value in presets
}

export function resolveLandingPresetJob(value: unknown) {
  if (!isLandingPresetJobId(value)) {
    return null
  }

  const job = presets[value]
  return [
    `岗位名称：${job.title}`,
    `公司：${job.company}`,
    `地点：${job.location}`,
    `经验要求：${job.experience}`,
    '',
    job.summary,
    '',
    '岗位职责：',
    ...job.responsibilities.map(item => `- ${item}`),
  ].join('\n')
}
