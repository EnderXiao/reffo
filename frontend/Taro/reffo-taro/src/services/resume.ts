import {apiClient} from './api';
import type {
  ResumeAnalysis,
  MatchingResult,
  OptimizedResume,
  ProcessResult,
} from '@/types';

/**
 * 简历分析请求参数
 */
export interface AnalyzeResumeRequest {
  /** Markdown 格式的简历内容 */
  resume_markdown: string;
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
  step2_matching: MatchingResult;
  /** 步骤 3: 优化后的简历 */
  step3_optimized_resume: string;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
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

function normalizeMatching(matching: MatchingResult): MatchingResult {
  return {
    ...matching,
    match_score: matching?.match_score ?? 0,
    hard_requirements_match: Array.isArray(matching?.hard_requirements_match)
      ? matching.hard_requirements_match
      : [],
    skill_match: {
      matched_skills: toStringArray(matching?.skill_match?.matched_skills),
      missing_skills: toStringArray(matching?.skill_match?.missing_skills),
      match_percentage: matching?.skill_match?.match_percentage ?? 0,
    },
    experience_match: {
      years_required: matching?.experience_match?.years_required ?? 0,
      years_actual: matching?.experience_match?.years_actual ?? 0,
      relevant_experience: toStringArray(matching?.experience_match?.relevant_experience),
      match_percentage: matching?.experience_match?.match_percentage ?? 0,
    },
    optimization_suggestions: toStringArray(matching?.optimization_suggestions),
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
  async analyzeResume(resumeMarkdown: string): Promise<ResumeAnalysis> {
    // 验证输入
    if (!resumeMarkdown || resumeMarkdown.trim().length < 10) {
      throw new Error('简历内容不能为空且至少需要 10 个字符');
    }

    // 调用 API
    const response = await apiClient.post<AnalyzeResumeResponse>(
      '/mvp/analyze',
      {
        resume_markdown: resumeMarkdown,
      },
    );

    return response.analysis;
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
   *   - `optimization_suggestions`: 优化建议
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
