import type {RequirementAnalysis} from '@/types/requirement-analysis'

export const requirementAnalysisFixture: RequirementAnalysis = {
  version: 'job-requirement-analysis-v1',
  portrait: {id: 'portrait', text: '能在会员业务场景中分析增长问题、设计方案并协同团队落地的人。', basis: 'inferred', strength: 'unspecified', sourceQuotes: ['负责会员增长策略并推动跨部门落地。'], rationale: '从增长任务与落地要求综合，不预设企业内部资源。'},
  tasks: [{id: 'task', text: '制定会员增长策略并推动跨部门落地。', basis: 'explicit', strength: 'unspecified', sourceQuotes: ['负责会员增长策略并推动跨部门落地。'], rationale: ''}],
  outcomes: [{id: 'outcome', text: '支持会员增长，具体绩效数值未说明。', basis: 'inferred', strength: 'unspecified', sourceQuotes: ['负责会员增长策略并推动跨部门落地。'], rationale: '增长是任务方向，但不能推定数值。'}],
  successConditions: [{id: 'condition', text: '识别增长问题，并协调方案落地所需资源。', basis: 'inferred', strength: 'unspecified', sourceQuotes: ['负责会员增长策略并推动跨部门落地。'], rationale: '任务需要分析判断与协作。'}],
  attributes: [{id: 'attribute', text: '增长分析与项目推进能力。', basis: 'inferred', strength: 'unspecified', sourceQuotes: ['负责会员增长策略并推动跨部门落地。'], rationale: '对应增长策略和协作任务。', dimension: 'ability', evidenceExpectation: '相似项目中的本人动作、交付及可验证结果。'}],
  externalRequirements: [{id: 'qualification', text: 'SQL 使用经验优先。', basis: 'explicit', strength: 'preferred', sourceQuotes: ['SQL 使用经验优先。'], rationale: ''}],
  unknowns: ['未说明团队规模、预算与工作方式。'], conflicts: [],
}
