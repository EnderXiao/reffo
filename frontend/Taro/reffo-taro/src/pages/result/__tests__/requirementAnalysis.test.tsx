import React from 'react'
import '@testing-library/jest-dom'
import {render, screen} from '@testing-library/react'
import {RequirementAnalysisPanel} from '../components/RequirementAnalysis.h5'
import {requirementAnalysisFixture as fixture} from '@/utils/__tests__/fixtures/requirement-analysis'
import {normalizeRequirementAnalysis} from '@/utils/requirement-analysis'

describe('要求解析', () => {
  test('shows only the ideal candidate portrait', () => {
    render(<RequirementAnalysisPanel value={fixture} />)
    expect(screen.getByRole('region', {name: '岗位理想候选人画像'})).toBeVisible()
    expect(screen.getByText(fixture.portrait!.text)).toBeVisible()
    expect(screen.queryByText('要求解析')).not.toBeInTheDocument()
    expect(screen.queryByText(fixture.tasks[0].text)).not.toBeInTheDocument()
    expect(screen.queryByText(fixture.portrait!.rationale)).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
  test.each([undefined, null, {}, {version: 'unknown'}, {...fixture, portrait: null}])('results without a portrait omit the card: %s', value => {
    const {container} = render(<RequirementAnalysisPanel value={value} />)
    expect(container).toBeEmptyDOMElement()
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
    expect(container.querySelector('img[src="x"]')).toBeNull()
  })
})
