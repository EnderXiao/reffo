import { ResumeAnalyzerAgent } from '@/agents/resume-analyzer'
import { MatchingAgent } from '@/agents/matching-agent'
import { ResumeGeneratorAgent } from '@/agents/resume-generator'
import type {
  JDStructure,
  MatchAnalysis,
  MvpProcessResponse,
  ResumeAnalysis,
  ResumeStructure,
} from '@/types'

export interface MvpProcessInput {
  resume_markdown: string
  jd_text: string
}

export interface ResumeAnalyzer {
  analyze(resumeMarkdown: string): Promise<ResumeAnalysis>
}

export interface Matcher {
  match(resume: ResumeStructure, jdText: string): Promise<MatchAnalysis>
}

export interface ResumeGenerator {
  generate(
    sourceResume: ResumeStructure,
    jd: JDStructure,
    matchAnalysis: MatchAnalysis
  ): Promise<string>
}

export interface MvpProcessAgents {
  analyzer: ResumeAnalyzer
  matcher: Matcher
  generator: ResumeGenerator
}

export function createDefaultMvpProcessAgents(): MvpProcessAgents {
  return {
    analyzer: new ResumeAnalyzerAgent(),
    matcher: new MatchingAgent(),
    generator: new ResumeGeneratorAgent(),
  }
}

export async function processResumeOptimization(
  input: MvpProcessInput,
  agents: MvpProcessAgents = createDefaultMvpProcessAgents()
): Promise<MvpProcessResponse> {
  const analysisResult = await agents.analyzer.analyze(input.resume_markdown)
  const matchResult = await agents.matcher.match(analysisResult.structured_resume, input.jd_text)
  const optimizedResume = await agents.generator.generate(
    analysisResult.structured_resume,
    matchResult.jd_structure,
    matchResult
  )

  return {
    step1_analysis: analysisResult,
    step2_matching: matchResult,
    step3_optimized_resume: optimizedResume,
  }
}
