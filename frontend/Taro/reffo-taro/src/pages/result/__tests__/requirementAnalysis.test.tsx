import React from 'react'
import '@testing-library/jest-dom'
import {fireEvent, render, screen} from '@testing-library/react'
import {RequirementAnalysisPanel} from '../components/RequirementAnalysis.h5'
import {requirementAnalysisFixture as fixture} from '@/utils/__tests__/fixtures/requirement-analysis'
import {normalizeRequirementAnalysis} from '@/utils/requirement-analysis'

describe('要求解析', () => {
  test('shows a concise portrait first, then requirements and source references on demand', () => {
    render(<RequirementAnalysisPanel value={fixture} />)
    expect(screen.getByText(fixture.portrait!.text)).toBeVisible()
    expect(screen.queryByText('要求强度待确认')).not.toBeInTheDocument()
    expect(screen.queryByText('对岗位的说明')).not.toBeInTheDocument()
    const expand = screen.getByRole('button', {name: '展开岗位说明与候选人要求'})
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(expand)
    expect(screen.getByText('对岗位的说明')).toBeVisible()
    expect(screen.getByText('对候选人的要求')).toBeVisible()
    expect(screen.getByText('优先')).toBeVisible()
    expect(screen.getByText('希望看到的证据：相似项目中的本人动作、交付及可验证结果。')).toBeVisible()
    fireEvent.click(screen.getAllByRole('button', {name: '查看依据'})[0])
    expect(screen.getByText('JD 原文：负责会员增长策略并推动跨部门落地。')).toBeVisible()
    fireEvent.click(screen.getByRole('button', {name: '收起岗位说明与候选人要求'}))
    expect(screen.queryByText('对岗位的说明')).not.toBeInTheDocument()
  })
  test.each([undefined, null, {}, {version: 'unknown'}])('old or unsupported results show a non-blocking empty state: %s', value => {
    render(<RequirementAnalysisPanel value={value} />)
    expect(screen.getByText('这份结果暂无要求解析，已有简历仍可查看。')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
  test('normalization tolerates partial legacy snapshots and keeps inference separate from necessity', () => {
    const value = JSON.parse(JSON.stringify(fixture))
    value.tasks.push({id: 'invalid', text: '无来源', basis: 'explicit', strength: 'necessary'})
    value.attributes[0].strength = 'necessary'
    const normalized = normalizeRequirementAnalysis(value)!
    expect(normalized.tasks).toHaveLength(1)
    expect(normalized.attributes[0].strength).toBe('unspecified')
    expect(normalized.externalRequirements[0].strength).toBe('preferred')
    expect(normalizeRequirementAnalysis(JSON.parse(JSON.stringify(normalized)))).toEqual(normalized)
  })
  test('model text is rendered as text, not HTML', () => {
    const value = {...fixture, portrait: {...fixture.portrait!, text: '<img src=x onerror=alert(1)>说明'}}
    const {container} = render(<RequirementAnalysisPanel value={value} />)
    expect(screen.getByText(value.portrait.text)).toBeVisible()
    expect(container.querySelector('img')).toBeNull()
  })
})
