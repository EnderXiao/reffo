import { describe, expect, test } from 'bun:test'
import presets from './landing-presets.json'
import { isLandingPresetJobId, resolveLandingPresetJob } from './landing-presets'

describe('Landing 预设岗位', () => {
  test('仅接受四个预设岗位 ID', () => {
    expect(Object.keys(presets)).toEqual(['software', 'data', 'operations', 'product'])
    for (const id of Object.keys(presets)) {
      expect(isLandingPresetJobId(id)).toBe(true)
    }
    for (const id of ['design', 'custom', '', null, undefined, 1]) {
      expect(isLandingPresetJobId(id)).toBe(false)
      expect(resolveLandingPresetJob(id)).toBeNull()
    }
  })

  test('四份岗位保留目标、职责、基本要求与加分项', () => {
    for (const id of Object.keys(presets) as Array<keyof typeof presets>) {
      const job = presets[id]
      const content = resolveLandingPresetJob(id)!
      expect(content).toContain(`岗位名称：${job.title}`)
      expect(content).toContain(`公司：${job.company}`)
      expect(content).toContain(`地点：${job.location}`)
      expect(content).toContain(`经验要求：${job.experience}`)
      expect(content).toContain(`岗位目标：${job.summary}`)
      expect(job.responsibilities).toHaveLength(3)
      expect(job.requirements).toHaveLength(3)
      for (const line of [...job.responsibilities, ...job.requirements]) {
        expect(content).toContain(`- ${line}`)
      }
      expect(content).toContain(`\n基本要求：\n`)
      expect(content).toEndWith(`\n加分项：${job.bonus}`)
      expect(content).not.toContain('薪资')
      expect(content).not.toContain('卡片短文案')
    }
  })

  test('独立产品交付经验保留为加分项而非基本要求', () => {
    const content = resolveLandingPresetJob('product')!
    const requirements = content.split('\n基本要求：\n')[1].split('\n加分项：')[0]
    expect(requirements).not.toContain('独立完成')
    expect(content.split('\n加分项：')[1]).toBe('有独立完成的小功能需求、原型或上线案例。仅有分析和运营经历也可讨论，但应说明尚需补足的产品交付能力。')
    expect(content).not.toContain('J4 不作为')
  })
})
