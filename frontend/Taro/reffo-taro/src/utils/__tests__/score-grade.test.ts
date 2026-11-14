import {resolveResumeGrade} from '../score-grade'

describe('score-grade', () => {
  test('按统一阈值解析简历评级', () => {
    expect(resolveResumeGrade(95)).toBe('A+')
    expect(resolveResumeGrade(90)).toBe('A+')
    expect(resolveResumeGrade(89)).toBe('A')
    expect(resolveResumeGrade(80)).toBe('A')
    expect(resolveResumeGrade(79)).toBe('B')
    expect(resolveResumeGrade(70)).toBe('B')
    expect(resolveResumeGrade(69)).toBe('C')
    expect(resolveResumeGrade(60)).toBe('C')
    expect(resolveResumeGrade(59)).toBe('D')
  })
})

test('未校准或未知分数不会显示为低分等级', () => {
  expect(resolveResumeGrade(null)).toBe('待评估')
  expect(resolveResumeGrade(undefined)).toBe('待评估')
  expect(resolveResumeGrade(Number.NaN)).toBe('待评估')
  expect(resolveResumeGrade(0)).toBe('D')
})
