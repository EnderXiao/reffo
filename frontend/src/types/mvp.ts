export interface ResumeAnalysis {
  quality_score: number
  strengths: string[]
  weaknesses: string[]
  suggestions: string[]
  capability_summary: string
}

export interface MatchAnalysis {
  match_score: number
  skill_match: {
    matched: string[]
    missing: string[]
  }
  experience_match: string
  strengths: string[]
  weaknesses: string[]
}

export interface ProcessResult {
  step1_analysis: ResumeAnalysis
  step2_matching: MatchAnalysis
  step3_optimized_resume: string
}

export interface ProcessRequest {
  resume_markdown: string
  jd_text: string
}
