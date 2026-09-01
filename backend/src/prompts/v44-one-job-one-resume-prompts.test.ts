import { describe, expect, test } from 'bun:test'
import {
  V44_ONE_JOB_PROMPT_VERSION,
  buildV44FinalAuditMessages,
  buildV44ResumePlanMessages,
  buildV44TargetedGenerationMessages,
} from '@/prompts/v44-one-job-one-resume-prompts'

function promptText(messages: Array<{ content: string }>) {
  return messages.map(message => message.content).join('\n')
}

describe('v4.4 one-job-one-resume candidate prompts', () => {
  test('defines an independently identifiable candidate version', () => {
    expect(V44_ONE_JOB_PROMPT_VERSION).toBe('4.4.5-one-job-balanced-evidence-deliverable')
  })

  test('builds a selective evidence plan instead of a rewrite checklist', () => {
    const prompt = promptText(buildV44ResumePlanMessages({
      sourceResume: { experience: [], projects: [] },
      jobDescription: { responsibilities: [] },
      matchAnalysis: { match_score: 0 },
    }))

    expect(prompt).toContain('target_value_proposition')
    expect(prompt).toContain('stable_core')
    expect(prompt).toContain('job_customized')
    expect(prompt).toContain('evidence_pillars')
    expect(prompt).toContain('selected_evidence')
    expect(prompt).toContain('expand|compress|timeline_line')
    expect(prompt).not.toContain('continuity_only')
    expect(prompt).toContain('include|omit')
    expect(prompt).toContain('最多 include 3 个')
    expect(prompt).toContain('50%-70%')
    expect(prompt).toContain('preserve_compact')
    expect(prompt).toContain('minimal_transfer')
    expect(prompt).toContain('min_business_bullets')
    expect(prompt).toContain('max_total_bullets')
    expect(prompt).toContain('verification_status=verified 或 self_reported')
    expect(prompt).toContain('不追求核心证据零复用')
  })

  test('balances stable career evidence with JD-specific customization', () => {
    const prompt = promptText(buildV44TargetedGenerationMessages({
      identityTimeline: { personal_info: {} },
      resumePlan: { evidence_pillars: [] },
    }))

    expect(prompt).toContain('稳定职业核心之上完成岗位定制')
    expect(prompt).toContain('不得回忆、推断或补充计划外素材')
    expect(prompt).toContain('timeline_line 只能集中放入“## 其他经历”')
    expect(prompt).toContain('清洗后路径为空时按 omit 处理')
    expect(prompt).toContain('家庭详细地址默认不输出')
    expect(prompt).toContain('不使用空泛的“赋能、驱动、全流程、精通、主导”')
    expect(prompt).toContain('安全硬上限，不是删除目标')
    expect(prompt).toContain('禁止空经历、空项目')
    expect(prompt).toContain('不得为了变短或制造差异删除 stable_core')
  })

  test('final audit repairs safe evidence before deletion and protects coverage', () => {
    const prompt = promptText(buildV44FinalAuditMessages({
      identityTimeline: { personal_info: {} },
      resumePlan: { content_budget: { max_total_bullets: 10 } },
      draftResume: '# 草稿',
    }))

    expect(prompt).toContain('优先使用同一白名单证据降级表达')
    expect(prompt).toContain('不得通过持续删除把简历审成空壳')
    expect(prompt).toContain('最多使用一次')
    expect(prompt).toContain('项目数字不得提升为整段工作成果')
    expect(prompt).toContain('最低覆盖')
    expect(prompt).toContain('禁止只删除正文而留下孤立标题')
  })
})
