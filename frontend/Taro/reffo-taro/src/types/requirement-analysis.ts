export interface RequirementAnalysisItem {
  id: string
  text: string
  basis: 'explicit' | 'inferred' | 'unknown'
  strength: 'necessary' | 'preferred' | 'unspecified'
  sourceQuotes: string[]
  rationale: string
  dimension?: 'knowledge' | 'skill' | 'experience' | 'ability' | 'behavior' | 'motivation_fit'
  evidenceExpectation?: string
}

export interface RequirementAnalysis {
  version: 'job-requirement-analysis-v1'
  portrait: RequirementAnalysisItem | null
  tasks: RequirementAnalysisItem[]
  outcomes: RequirementAnalysisItem[]
  successConditions: RequirementAnalysisItem[]
  attributes: RequirementAnalysisItem[]
  externalRequirements: RequirementAnalysisItem[]
  unknowns: string[]
  conflicts: RequirementAnalysisItem[]
}
