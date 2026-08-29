import { describe, expect, test } from 'bun:test'
import {
  V44_ONE_JOB_PROMPT_VERSION,
  buildV44AggressiveGenerationMessages,
  buildV44BlindJudgeMessages,
  buildV44FinalAuditMessages,
  buildV44ResumePlanMessages,
} from '@/prompts/v44-one-job-one-resume-prompts'

function promptText(messages: Array<{ content: string }>) {
  return messages.map(message => message.content).join('\n')
}

describe('v4.4 one-job-one-resume candidate prompts', () => {
  test('defines an independently identifiable candidate version', () => {
    expect(V44_ONE_JOB_PROMPT_VERSION).toBe('4.4.4-one-job-adaptive-aggressive-final')
  })

  test('builds a selective evidence plan instead of a rewrite checklist', () => {
    const prompt = promptText(buildV44ResumePlanMessages({
      sourceResume: { experience: [], projects: [] },
      jobDescription: { responsibilities: [] },
      matchAnalysis: { match_score: 0 },
    }))

    expect(prompt).toContain('target_value_proposition')
    expect(prompt).toContain('evidence_pillars')
    expect(prompt).toContain('selected_evidence')
    expect(prompt).toContain('expand|compress|continuity_only')
    expect(prompt).toContain('include|omit')
    expect(prompt).toContain('最多 include 3 个')
    expect(prompt).toContain('60%-70%')
    expect(prompt).toContain('preserve_compact')
    expect(prompt).toContain('minimal_transfer')
    expect(prompt).toContain('max_total_bullets')
    expect(prompt).toContain('verification_status=verified 或 self_reported')
  })

  test('allows aggressive omission without allowing hard-fact invention', () => {
    const prompt = promptText(buildV44AggressiveGenerationMessages({
      identityTimeline: { personal_info: {} },
      resumePlan: { evidence_pillars: [] },
    }))

    expect(prompt).toContain('可以牺牲低相关事实的完整呈现')
    expect(prompt).toContain('不得回忆、推断或补充计划外素材')
    expect(prompt).toContain('continuity_only 只保留公司/岗位/时间')
    expect(prompt).toContain('omit 的项目不得出现')
    expect(prompt).toContain('家庭详细地址默认不输出')
    expect(prompt).toContain('不使用空泛的“赋能、驱动、全流程、精通、主导”')
    expect(prompt).toContain('必须排除')
    expect(prompt).toContain('全是硬上限')
  })

  test('final audit removes uncertain evidence and enforces scope and hard budgets', () => {
    const prompt = promptText(buildV44FinalAuditMessages({
      identityTimeline: { personal_info: {} },
      resumePlan: { content_budget: { max_total_bullets: 10 } },
      draftResume: '# 草稿',
    }))

    expect(prompt).toContain('删除越界内容、修复归因、压到硬预算内')
    expect(prompt).toContain('最多使用一次')
    expect(prompt).toContain('项目数字不得提升为整段工作成果')
    expect(prompt).toContain('必须分别不超过')
  })

  test('judge rewards job specificity and evidence selection', () => {
    const prompt = promptText(buildV44BlindJudgeMessages({
      sourceResume: '源简历',
      jobDescription: '目标 JD',
      baselineResume: '旧版',
      candidateResume: '候选版',
    }))

    expect(prompt).toContain('job_specificity')
    expect(prompt).toContain('evidence_selection')
    expect(prompt).toContain('irrelevant_or_overexpanded_content')
    expect(prompt).toContain('不因省略真实事实扣分')
    expect(prompt).toContain('total_score 不得高于 59')
  })
})
