import {apiClient} from './api';
import {normalizeRequirementAnalysis} from '@/utils/requirement-analysis';
import type {
  ResumeAnalysis,
  MatchingResult,
  OptimizedResume,
  ProcessResult,
  InterviewSuggestions,
  JobDescriptionStructure,
  MatchWeaknessDetail,
  MatchOptimizationStrategyDetail,
} from '@/types';

/**
 * 简历分析请求参数
 */
export interface AnalyzeResumeRequest {
  /** Markdown 格式的简历内容 */
  resume_markdown: string;
  landing?: boolean;
}

/**
 * 简历分析响应数据
 */
export interface AnalyzeResumeResponse {
  /** 简历分析结果 */
  analysis: ResumeAnalysis;
}

/**
 * 完整优化流程请求参数
 */
export interface ProcessResumeRequest {
  /** Markdown 格式的简历内容 */
  resume_markdown: string;
  /** JD 文本内容 */
  jd_text: string;
}

/**
 * 完整优化流程响应数据
 */
export interface ProcessResumeResponse {
  /** 步骤 1: 简历分析结果 */
  step1_analysis: ResumeAnalysis;
  /** 步骤 2: 匹配分析结果 */
  step2_matching: MatchingApiResult;
  /** 步骤 3: 优化后的简历 */
  step3_optimized_resume: string;
  /** 步骤 4: 面试建议 */
  step4_interview_suggestions?: InterviewSuggestions;
}

export interface MatchResumeRequest {
  structured_resume: ResumeAnalysis['structured_resume'];
  jd_text?: string;
  preset_jd_id?: string;
}

export interface GenerateOptimizedResumeRequest {
  structured_resume: ResumeAnalysis['structured_resume'];
  matching: MatchingApiResult;
  landing?: boolean;
  preset_jd_id?: string;
}

export interface GenerateInterviewSuggestionsRequest {
  analysis: ResumeAnalysis;
  matching: MatchingResult;
  optimized_resume: string;
  landing?: boolean;
  preset_jd_id?: string;
}

interface MatchingApiResult {
  requirement_analysis?: unknown;
  match_score?: number;
  hard_requirements_match?: unknown;
  skill_match?: unknown;
  experience_match?: unknown;
  soft_skills_match?: unknown;
  strengths?: unknown;
  weaknesses?: unknown;
  weakness_details?: unknown;
  positioning_strategy?: unknown;
  optimization_suggestions?: unknown;
  optimization_strategy_details?: unknown;
  context_fit?: unknown;
  jd_structure?: JobDescriptionStructure;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function normalizeHardRequirements(value: unknown): MatchingResult['hard_requirements_match'] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([requirement, matched]) => ({
      requirement,
      matched: Boolean(matched),
    }));
  }

  return [];
}

function normalizeWeaknessDetails(value: unknown): MatchWeaknessDetail[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }

    const detail = item as Record<string, unknown>;
    const evidenceType = detail.evidence_type;
    if (
      evidenceType !== 'direct_missing' &&
      evidenceType !== 'implicit_evidence' &&
      evidenceType !== 'wording_gap'
    ) {
      return [];
    }

    return [{
      id: typeof detail.id === 'string' ? detail.id : undefined,
      priority: detail.priority === 'high' || detail.priority === 'medium' || detail.priority === 'low'
        ? detail.priority
        : undefined,
      weakness: typeof detail.weakness === 'string' ? detail.weakness : '',
      evidence_type: evidenceType,
      jd_requirement: typeof detail.jd_requirement === 'string' ? detail.jd_requirement : '',
      evidence: typeof detail.evidence === 'string' ? detail.evidence : '',
      impact: typeof detail.impact === 'string' ? detail.impact : '',
      suggestion: typeof detail.suggestion === 'string' ? detail.suggestion : '',
    }];
  });
}

function normalizeOptimizationStrategyDetails(value: unknown): MatchOptimizationStrategyDetail[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }

    const detail = item as Record<string, unknown>;
    const rawExample = detail.optimization_example;
    const example = rawExample && typeof rawExample === 'object'
      ? rawExample as Record<string, unknown>
      : {};
    const strategyPoint = typeof detail.strategy_point === 'string'
      ? detail.strategy_point.trim()
      : '';

    if (!strategyPoint) {
      return [];
    }

    return [{
      id: typeof detail.id === 'string' ? detail.id : '',
      related_gap_ids: toStringArray(detail.related_gap_ids),
      strategy_point: strategyPoint,
      rationale: typeof detail.rationale === 'string' ? detail.rationale : '',
      optimization_example: {
        source_path: typeof example.source_path === 'string' ? example.source_path : '',
        source_quote: typeof example.source_quote === 'string' ? example.source_quote : '',
        optimized_content: typeof example.optimized_content === 'string'
          ? example.optimized_content
          : '',
      },
    }];
  });
}

function normalizeAnalysis(analysis: ResumeAnalysis): ResumeAnalysis {
  return {
    ...analysis,
    quality_score: analysis?.quality_score ?? 0,
    strengths: toStringArray(analysis?.strengths),
    weaknesses: toStringArray(analysis?.weaknesses),
    suggestions: toStringArray(analysis?.suggestions),
    capability_summary: analysis?.capability_summary || '',
    structured_resume: analysis?.structured_resume || {
      personal_info: {name: ''},
      education: [],
      experience: [],
      projects: [],
      skills: {hard_skills: [], soft_skills: []},
    },
  };
}

function normalizeMatching(matching: MatchingApiResult | MatchingResult): MatchingResult {
  const rawSkillMatch = matching?.skill_match as unknown as {
    matched_skills?: unknown;
    missing_skills?: unknown;
    matched?: unknown;
    missing?: unknown;
    match_percentage?: number;
    required_skill_checks?: unknown;
  };
  const matchedSkills = toStringArray(
    rawSkillMatch?.matched_skills ?? rawSkillMatch?.matched,
  );
  const missingSkills = toStringArray(
    rawSkillMatch?.missing_skills ?? rawSkillMatch?.missing,
  );
  const requiredSkillChecks = Array.isArray(rawSkillMatch?.required_skill_checks)
    ? rawSkillMatch.required_skill_checks.flatMap(item => {
      if (!item || typeof item !== 'object') return []
      const check = item as Record<string, unknown>
      const status = check.status
      if (status !== 'matched' && status !== 'missing' && status !== 'unclear') return []
      const normalizedStatus: 'matched' | 'missing' | 'unclear' = status
      return [{
        requirement: typeof check.requirement === 'string' ? check.requirement : '',
        status: normalizedStatus,
        evidence: typeof check.evidence === 'string' ? check.evidence : '',
      }]
    })
    : [];
  const experienceMatch = matching?.experience_match;
  const experienceMatchText =
    typeof experienceMatch === 'string' ? experienceMatch : '';
  const structuredExperienceMatch = experienceMatch && typeof experienceMatch === 'object'
    ? experienceMatch as Partial<MatchingResult['experience_match']>
    : undefined;
  const rawMatching = matching as MatchingApiResult;
  const weaknessDetails = normalizeWeaknessDetails(rawMatching.weakness_details);
  const optimizationStrategyDetails = normalizeOptimizationStrategyDetails(
    rawMatching.optimization_strategy_details,
  );
  const contextFit = rawMatching.context_fit && typeof rawMatching.context_fit === 'object'
    ? rawMatching.context_fit as Record<string, unknown>
    : undefined;

  return {
    ...matching,
    match_score: matching?.match_score ?? 0,
    hard_requirements_match: normalizeHardRequirements(matching?.hard_requirements_match),
    skill_match: {
      matched_skills: matchedSkills,
      missing_skills: missingSkills,
      match_percentage: rawSkillMatch?.match_percentage ?? matching?.match_score ?? 0,
      ...(requiredSkillChecks.length > 0 ? {required_skill_checks: requiredSkillChecks} : {}),
    },
    experience_match: {
      years_required: structuredExperienceMatch
        ? structuredExperienceMatch.years_required ?? 0
        : 0,
      years_actual: structuredExperienceMatch
        ? structuredExperienceMatch.years_actual ?? 0
        : 0,
      relevant_experience: structuredExperienceMatch
        ? toStringArray(structuredExperienceMatch.relevant_experience)
        : experienceMatchText
          ? [experienceMatchText]
          : [],
      match_percentage: structuredExperienceMatch
        ? structuredExperienceMatch.match_percentage ?? 0
        : 0,
    },
    optimization_suggestions: optimizationStrategyDetails.length > 0
      ? optimizationStrategyDetails.map(detail => detail.strategy_point)
      : toStringArray(matching?.optimization_suggestions),
    optimization_strategy_details: optimizationStrategyDetails,
    strengths: toStringArray(rawMatching.strengths),
    weaknesses: weaknessDetails.length > 0
      ? weaknessDetails.map(detail => detail.weakness).filter(Boolean)
      : toStringArray(rawMatching.weaknesses),
    weakness_details: weaknessDetails,
    soft_skills_match: typeof rawMatching.soft_skills_match === 'string'
      ? rawMatching.soft_skills_match
      : '',
    positioning_strategy: typeof rawMatching.positioning_strategy === 'string'
      ? rawMatching.positioning_strategy
      : '',
    context_fit: contextFit ? {
      company_alignment: typeof contextFit.company_alignment === 'string'
        ? contextFit.company_alignment
        : '',
      location_alignment: typeof contextFit.location_alignment === 'string'
        ? contextFit.location_alignment
        : '',
      hypotheses_used: toStringArray(contextFit.hypotheses_used),
    } : undefined,
    jd_structure: rawMatching.jd_structure,
    requirement_analysis: normalizeRequirementAnalysis(rawMatching.requirement_analysis),
  };
}

function toMatchingApiPayload(matching: MatchingResult): MatchingApiResult {
  return {
    match_score: matching.match_score,
    hard_requirements_match: Object.fromEntries(
      matching.hard_requirements_match.map(item => [item.requirement, item.matched]),
    ),
    skill_match: {
      matched: matching.skill_match.matched_skills,
      missing: matching.skill_match.missing_skills,
      ...(matching.skill_match.required_skill_checks?.length
        ? {required_skill_checks: matching.skill_match.required_skill_checks}
        : {}),
    },
    experience_match: matching.experience_match.relevant_experience.join('；'),
    soft_skills_match: matching.soft_skills_match ?? '',
    strengths: matching.strengths ?? [],
    weaknesses: matching.weaknesses ?? matching.optimization_suggestions,
    weakness_details: matching.weakness_details ?? [],
    positioning_strategy: matching.positioning_strategy ?? '',
    optimization_suggestions: matching.optimization_suggestions,
    optimization_strategy_details: matching.optimization_strategy_details ?? [],
    context_fit: matching.context_fit,
    jd_structure: matching.jd_structure,
    ...(matching.requirement_analysis ? {requirement_analysis: matching.requirement_analysis} : {}),
  };
}

function normalizeInterviewSuggestions(value: Partial<InterviewSuggestions> | null | undefined): InterviewSuggestions {
  return {
    questions: toStringArray(value?.questions).slice(0, 4),
    follow_up_questions: toStringArray(value?.follow_up_questions).slice(0, 3),
    story_recommendations: Array.isArray(value?.story_recommendations)
      ? value.story_recommendations
        .filter(item => item && typeof item === 'object')
        .map(item => ({
          title: typeof item.title === 'string' ? item.title : '',
          background: typeof item.background === 'string' ? item.background : '',
          result: typeof item.result === 'string' ? item.result : '',
          storytelling_approach: toStringArray(item.storytelling_approach).slice(0, 3),
        }))
        .filter(item => item.title || item.background || item.result || item.storytelling_approach.length > 0)
        .slice(0, 2)
      : [],
  };
}

/**
 * 简历 API 服务
 *
 * 提供简历相关的 API 调用方法，包括简历分析和完整优化流程
 *
 * **Validates: Requirements 7.1**
 *
 * @example
 * ```typescript
 * import { resumeApi } from '@/services/resume'
 *
 * // 分析简历
 * const analysis = await resumeApi.analyzeResume('# 张三\n...')
 *
 * // 完整优化流程
 * const result = await resumeApi.processResume('# 张三\n...', '岗位职责：...')
 * ```
 */
export class ResumeApi {
  /**
   * 分析简历
   *
   * 调用后端 `/mvp/analyze` 接口，分析简历内容并返回质量评分、优势、劣势等信息
   *
   * **API 端点:** `POST /api/v1/mvp/analyze`
   *
   * **请求参数:**
   * - `resume_markdown`: Markdown 格式的简历内容（必填，最少 10 个字符）
   *
   * **响应数据:**
   * - `analysis`: 简历分析结果，包含：
   *   - `quality_score`: 质量评分（0-100）
   *   - `strengths`: 优势列表
   *   - `weaknesses`: 劣势列表
   *   - `suggestions`: 优化建议列表
   *   - `capability_summary`: 能力总结
   *   - `structured_resume`: 结构化简历数据
   *
   * **错误处理:**
   * - 当简历内容为空或过短时，返回 400 错误
   * - 当 AI 分析失败时，返回 500 错误
   * - 当网络请求失败时，抛出 `RequestError`
   *
   * **性能:**
   * - 预计响应时间：5-15 秒（取决于简历长度和 AI 模型响应速度）
   * - 超时时间：30 秒
   *
   * @param resumeMarkdown Markdown 格式的简历内容
   * @returns Promise<ResumeAnalysis> 简历分析结果
   * @throws {RequestError} 当请求失败时抛出错误
   *
   * @example
   * ```typescript
   * try {
   *   const analysis = await resumeApi.analyzeResume(`
   *     # 张三
   *
   *     ## 个人信息
   *     - 邮箱: zhangsan@example.com
   *     - 电话: 138****1234
   *
   *     ## 工作经历
   *     ### 软件工程师 | ABC 公司 | 2020-2023
   *     - 负责后端开发
   *     - 参与系统设计
   *   `)
   *
   *   console.log('质量评分:', analysis.quality_score)
   *   console.log('优势:', analysis.strengths)
   *   console.log('劣势:', analysis.weaknesses)
   * } catch (error) {
   *   if (error instanceof RequestError) {
   *     console.error('分析失败:', error.message)
   *   }
   * }
   * ```
   */
  async analyzeResume(
    resumeMarkdown: string,
    options: {landing?: boolean} = {},
  ): Promise<ResumeAnalysis> {
    // 验证输入
    if (!resumeMarkdown || resumeMarkdown.trim().length < 10) {
      throw new Error('简历内容不能为空且至少需要 10 个字符');
    }

    // 调用 API
    const response = await apiClient.post<AnalyzeResumeResponse | ResumeAnalysis>(
      '/mvp/analyze',
      {
        resume_markdown: resumeMarkdown,
        ...(options.landing ? {landing: true} : {}),
      },
      // Backend analysis allows up to 120s for model calls and business
      // recovery. Keep H5 from aborting the request at ApiClient's 30s default.
      {timeout: 120000},
    );

    const analysis = 'analysis' in response ? response.analysis : response;

    return normalizeAnalysis(analysis);
  }

  async matchResume(
    analysis: ResumeAnalysis,
    jd: string | {presetJdId: string},
  ): Promise<MatchingResult> {
    if (!analysis?.structured_resume) {
      throw new Error('简历分析结果不存在');
    }

    if (typeof jd === 'string' && (!jd || jd.trim().length < 10)) {
      throw new Error('JD 内容不能为空且至少需要 10 个字符');
    }

    if (typeof jd !== 'string' && !jd.presetJdId) {
      throw new Error('预设 JD ID 不存在');
    }

    const response = await apiClient.post<MatchingApiResult>(
      '/mvp/match',
      {
        structured_resume: analysis.structured_resume,
        ...(typeof jd === 'string'
          ? {jd_text: jd}
          : {preset_jd_id: jd.presetJdId}),
      } satisfies MatchResumeRequest,
      // Match may perform up to two server-side continuation calls after a
      // truncated structured response. Keep the client timeout above the
      // backend's 60s workflow budget plus continuation overhead.
      {timeout: 240000},
    );

    return normalizeMatching(response);
  }

  async generateOptimizedResume(
    analysis: ResumeAnalysis,
    matching: MatchingResult,
    options: {landing?: boolean; presetJdId?: string} = {},
  ): Promise<OptimizedResume> {
    if (!analysis?.structured_resume) {
      throw new Error('简历分析结果不存在');
    }

    if (!matching) {
      throw new Error('匹配分析结果不存在');
    }

    if (!matching.jd_structure) {
      throw new Error('目标岗位结构化结果不存在');
    }

    const response = await apiClient.post<OptimizedResume>(
      '/mvp/generate',
      {
        structured_resume: analysis.structured_resume,
        matching: toMatchingApiPayload(matching),
        ...(options.landing ? {landing: true} : {}),
        ...(options.presetJdId ? {preset_jd_id: options.presetJdId} : {}),
      } satisfies GenerateOptimizedResumeRequest,
      {timeout: 90000},
    );

    return {
      optimized_resume: response?.optimized_resume || '',
      changes_summary: toStringArray(response?.changes_summary ?? matching.optimization_suggestions),
      improvement_score: response?.improvement_score ?? Math.max(0, matching.match_score - analysis.quality_score),
    };
  }

  async generateInterviewSuggestions(
    analysis: ResumeAnalysis,
    matching: MatchingResult,
    optimized: OptimizedResume,
    options: {landing?: boolean; presetJdId?: string} = {},
  ): Promise<InterviewSuggestions> {
    if (!analysis) {
      throw new Error('简历分析结果不存在');
    }

    if (!matching) {
      throw new Error('匹配分析结果不存在');
    }

    if (!optimized?.optimized_resume || optimized.optimized_resume.trim().length < 10) {
      throw new Error('最佳简历结果不存在');
    }

    const response = await apiClient.post<InterviewSuggestions>(
      '/mvp/interview',
      {
        analysis,
        matching,
        optimized_resume: optimized.optimized_resume,
        ...(options.landing ? {landing: true} : {}),
        ...(options.presetJdId ? {preset_jd_id: options.presetJdId} : {}),
      } satisfies GenerateInterviewSuggestionsRequest,
      {timeout: 60000},
    );

    return normalizeInterviewSuggestions(response);
  }

  /**
   * 完整简历优化流程
   *
   * 调用后端 `/mvp/process` 接口，执行完整的简历优化流程：
   * 1. 分析简历（质量评分、结构化提取）
   * 2. 匹配分析（与 JD 的匹配度）
   * 3. 生成优化简历（基于匹配结果优化）
   *
   * **API 端点:** `POST /api/v1/mvp/process`
   *
   * **请求参数:**
   * - `resume_markdown`: Markdown 格式的简历内容（必填，最少 10 个字符）
   * - `jd_text`: JD 文本内容（必填，最少 10 个字符）
   *
   * **响应数据:**
   * - `step1_analysis`: 简历分析结果
   * - `step2_matching`: 匹配分析结果，包含：
   *   - `match_score`: 匹配度评分（0-100）
   *   - `hard_requirements_match`: 硬性要求匹配情况
   *   - `skill_match`: 技能匹配情况
   *   - `experience_match`: 经验匹配情况
   *   - `weakness_details`: 结构化岗位差距
   *   - `optimization_strategy_details`: 含原文与改写示例的结构化优化策略
   *   - `optimization_suggestions`: 兼容旧客户端的策略摘要
   * - `step3_optimized_resume`: 优化后的简历（Markdown 格式）
   *
   * **错误处理:**
   * - 当简历或 JD 内容为空或过短时，返回 400 错误
   * - 当 AI 处理失败时，返回 500 错误
   * - 当网络请求失败时，抛出 `RequestError`
   *
   * **性能:**
   * - 预计响应时间：15-40 秒（取决于内容长度和 AI 模型响应速度）
   * - 超时时间：60 秒（建议使用自定义超时）
   *
   * @param resumeMarkdown Markdown 格式的简历内容
   * @param jdText JD 文本内容
   * @returns Promise<ProcessResult> 完整优化流程结果
   * @throws {RequestError} 当请求失败时抛出错误
   *
   * @example
   * ```typescript
   * try {
   *   const result = await resumeApi.processResume(
   *     `# 张三\n\n## 工作经历\n...`,
   *     `岗位名称：后端开发工程师\n\n岗位职责：\n1. 负责后端服务开发\n...`
   *   )
   *
   *   console.log('简历分析:', result.analysis)
   *   console.log('匹配度:', result.matching.match_score)
   *   console.log('优化后的简历:', result.optimized)
   * } catch (error) {
   *   if (error instanceof RequestError) {
   *     console.error('优化失败:', error.message)
   *   }
   * }
   * ```
   */
  async processResume(
    resumeMarkdown: string,
    jdText: string,
  ): Promise<ProcessResult> {
    // 验证输入
    if (!resumeMarkdown || resumeMarkdown.trim().length < 10) {
      throw new Error('简历内容不能为空且至少需要 10 个字符');
    }

    if (!jdText || jdText.trim().length < 10) {
      throw new Error('JD 内容不能为空且至少需要 10 个字符');
    }

    // 调用 API（使用较长的超时时间）
    const response = await apiClient.post<ProcessResumeResponse>(
      '/mvp/process',
      {
        resume_markdown: resumeMarkdown,
        jd_text: jdText,
      },
    );

    const analysis = normalizeAnalysis(response.step1_analysis);
    const matching = normalizeMatching(response.step2_matching);
    const optimizedResume = typeof response.step3_optimized_resume === 'string'
      ? response.step3_optimized_resume
      : '';

    // 转换响应格式为统一的 ProcessResult 格式
    return {
      analysis,
      matching,
      optimized: {
        optimized_resume: optimizedResume,
        changes_summary: matching.optimization_suggestions,
        improvement_score:
          matching.match_score -
          (analysis.quality_score || 0),
      },
      interview: normalizeInterviewSuggestions(response.step4_interview_suggestions),
    };
  }
}

/**
 * 默认简历 API 实例
 *
 * 提供一个全局单例，方便在应用中直接使用
 *
 * @example
 * ```typescript
 * import { resumeApi } from '@/services/resume'
 *
 * // 直接使用
 * const analysis = await resumeApi.analyzeResume('# 张三\n...')
 * ```
 */
export const resumeApi = new ResumeApi();
