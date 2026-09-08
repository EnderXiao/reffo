import {useState} from 'react'
import {Text, View} from '@tarojs/components'
import type {RequirementAnalysisItem} from '@/types/requirement-analysis'
import {normalizeRequirementAnalysis} from '@/utils/requirement-analysis'
import './requirement-analysis.h5.scss'

const basisLabels = {explicit: 'JD 明示', inferred: '任务推导', unknown: '未说明'}
const strengthLabels = {necessary: '必要', preferred: '优先', unspecified: '要求强度待确认'}
const dimensions = {knowledge: '知识', skill: '技能', experience: '经验', ability: '能力', behavior: '行为方式', motivation_fit: '动机与适配'}

function AnalysisItem({item, showStrength = false}: {item: RequirementAnalysisItem; showStrength?: boolean}) {
  const [open, setOpen] = useState(false)
  return <View className='reffo-requirements__item'>
    <View className='reffo-requirements__tags'>
      <Text>{basisLabels[item.basis]}</Text>
      {showStrength && <Text>{strengthLabels[item.strength]}</Text>}
      {item.dimension && <Text>{dimensions[item.dimension]}</Text>}
    </View>
    <Text className='reffo-requirements__text'>{item.text}</Text>
    {item.evidenceExpectation && <Text className='reffo-requirements__evidence'>希望看到的证据：{item.evidenceExpectation}</Text>}
    {(item.sourceQuotes.length > 0 || item.rationale) && <>
      <button type='button' className='reffo-requirements__source-toggle' aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '收起依据' : '查看依据'}</button>
      {open && <View className='reffo-requirements__sources'>
        {item.rationale && <Text>{item.rationale}</Text>}
        {item.sourceQuotes.map((quote, index) => <Text key={`${item.id}-${index}`}>JD 原文：{quote}</Text>)}
      </View>}
    </>}
  </View>
}

function ItemGroup({title, items, empty, showStrength = false}: {title: string; items: RequirementAnalysisItem[]; empty: string; showStrength?: boolean}) {
  return <View className='reffo-requirements__group'>
    <Text className='reffo-requirements__group-title'>{title}</Text>
    {items.length ? items.map(item => <AnalysisItem key={item.id} item={item} showStrength={showStrength} />) : <Text className='reffo-requirements__muted'>{empty}</Text>}
  </View>
}

export function RequirementAnalysisPanel({value}: {value: unknown}) {
  const [expanded, setExpanded] = useState(false)
  const analysis = normalizeRequirementAnalysis(value)
  return <View className='reffo-requirements'>
    <Text className='reffo-requirements__title'>要求解析</Text>
    <Text className='reffo-requirements__muted'>先理解岗位，再看现有经历如何回应。</Text>
    {!analysis ? <Text className='reffo-requirements__empty'>这份结果暂无要求解析，已有简历仍可查看。</Text> : <>
      <View className='reffo-requirements__portrait'>
        <Text className='reffo-requirements__group-title'>理想候选人画像</Text>
        {analysis.portrait ? <AnalysisItem item={analysis.portrait} /> : <Text className='reffo-requirements__muted'>现有解析尚未形成一句话画像，可展开查看已解析要求。</Text>}
      </View>
      <Text className='reffo-requirements__muted'>基于 JD 的分析，不是企业官方画像，也不代表你已满足这些要求。</Text>
      <button type='button' className='reffo-requirements__expand' aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '收起岗位说明与候选人要求' : '展开岗位说明与候选人要求'}</button>
      {expanded && <View className='reffo-requirements__details'>
        <Text className='reffo-requirements__section-title'>对岗位的说明</Text>
        <ItemGroup title='岗位任务 · 需要做什么' items={analysis.tasks} empty='现有解析未提供明确任务。' />
        <ItemGroup title='绩效目标 · 希望产生什么结果' items={analysis.outcomes} empty='未解析出明确绩效目标，不推定具体 KPI。' />
        <ItemGroup title='成功条件 · 怎样才可能做好' items={analysis.successConditions} empty='现有解析未提供成功条件。' />
        <Text className='reffo-requirements__muted'>人才属性与期望证据见下方“胜任与适配”，不重复列同一要求。</Text>
        <Text className='reffo-requirements__section-title'>对候选人的要求</Text>
        <ItemGroup title='外在要求信号' items={analysis.externalRequirements} empty='现有解析未提供明确资格条件。' showStrength />
        <ItemGroup title='胜任与适配 · 人才属性' items={analysis.attributes} empty='没有足够信息推导人才属性，不预设人格或稳定性。' showStrength />
        {!!analysis.conflicts.length && <ItemGroup title='原文存在的不同口径' items={analysis.conflicts} empty='' />}
        {!!analysis.unknowns.length && <View className='reffo-requirements__group'><Text className='reffo-requirements__group-title'>尚不明确</Text>{analysis.unknowns.map((text, index) => <Text className='reffo-requirements__muted' key={index}>{text}</Text>)}</View>}
      </View>}
    </>}
  </View>
}
