import {ResumeApi} from '../resume';
import {apiClient} from '../api';
import {RequestError} from '@/utils/request';
import type {ResumeAnalysis, MatchingResult, StructuredResume} from '@/types';

// Mock apiClient
const mockPost = jest.fn();
apiClient.post = mockPost as any;

describe('ResumeApi', () => {
  let resumeApi: ResumeApi;

  beforeEach(() => {
    resumeApi = new ResumeApi();
    mockPost.mockClear();
  });

  describe('analyzeResume', () => {
    const sampleResume = `# 张三

## 个人信息
- 邮箱: zhangsan@example.com
- 电话: 138****1234

## 工作经历
### 软件工程师 | ABC 公司 | 2020-2023
- 负责后端开发
- 参与系统设计`;

    const mockAnalysisResponse: ResumeAnalysis = {
      quality_score: 75,
      strengths: ['工作经历清晰', '技术栈明确'],
      weaknesses: ['缺少项目经验', '技能描述不够详细'],
      suggestions: ['添加具体项目案例', '量化工作成果'],
      capability_summary: '3 年后端开发经验，熟悉系统设计',
      structured_resume: {
        personal_info: {
          name: '张三',
          email: 'zhangsan@example.com',
          phone: '138****1234',
        },
        education: [],
        experience: [
          {
            company: 'ABC 公司',
            position: '软件工程师',
            start_date: '2020',
            end_date: '2023',
            responsibilities: ['负责后端开发', '参与系统设计'],
            achievements: [],
          },
        ],
        projects: [],
        skills: {
          hard_skills: [],
          soft_skills: [],
        },
      } as StructuredResume,
    };

    test('should analyze resume successfully', async () => {
      // Mock API 响应
      mockPost.mockResolvedValue({
        analysis: mockAnalysisResponse,
      });

      // 调用方法
      const result = await resumeApi.analyzeResume(sampleResume);

      // 验证 API 调用
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPost).toHaveBeenCalledWith('/mvp/analyze', {
        resume_markdown: sampleResume,
      });

      // 验证返回结果
      expect(result).toEqual(mockAnalysisResponse);
      expect(result.quality_score).toBe(75);
      expect(result.strengths).toHaveLength(2);
      expect(result.weaknesses).toHaveLength(2);
      expect(result.suggestions).toHaveLength(2);
    });

    test('should throw error when resume is empty', async () => {
      await expect(resumeApi.analyzeResume('')).rejects.toThrow(
        '简历内容不能为空且至少需要 10 个字符',
      );

      // 不应该调用 API
      expect(mockPost).not.toHaveBeenCalled();
    });

    test('should throw error when resume is too short', async () => {
      await expect(resumeApi.analyzeResume('短')).rejects.toThrow(
        '简历内容不能为空且至少需要 10 个字符',
      );

      // 不应该调用 API
      expect(mockPost).not.toHaveBeenCalled();
    });

    test('should throw error when resume is only whitespace', async () => {
      await expect(resumeApi.analyzeResume('   \n\n   ')).rejects.toThrow(
        '简历内容不能为空且至少需要 10 个字符',
      );

      // 不应该调用 API
      expect(mockPost).not.toHaveBeenCalled();
    });

    test('should handle API error', async () => {
      // Mock API 错误
      const apiError = new RequestError('分析失败', 'ANALYSIS_FAILED', 500);
      mockPost.mockRejectedValue(apiError);

      // 调用方法并验证错误
      await expect(resumeApi.analyzeResume(sampleResume)).rejects.toThrow(
        apiError,
      );

      // 验证 API 被调用
      expect(mockPost).toHaveBeenCalledTimes(1);
    });

    test('should handle network error', async () => {
      // Mock 网络错误
      const networkError = new RequestError('网络连接失败', 'NETWORK_ERROR');
      mockPost.mockRejectedValue(networkError);

      // 调用方法并验证错误
      await expect(resumeApi.analyzeResume(sampleResume)).rejects.toThrow(
        networkError,
      );
    });

    test('should accept minimum valid resume length', async () => {
      // Mock API 响应
      mockPost.mockResolvedValue({
        analysis: mockAnalysisResponse,
      });

      // 10 个字符的简历（最小有效长度）
      const minResume = '1234567890';
      await resumeApi.analyzeResume(minResume);

      // 验证 API 被调用
      expect(mockPost).toHaveBeenCalledWith('/mvp/analyze', {
        resume_markdown: minResume,
      });
    });
  });

  describe('step endpoint contracts', () => {
    const structuredResume: StructuredResume = {
      personal_info: {name: '张三'},
      education: [],
      experience: [{
        company: '示例公司',
        position: '产品经理',
        time_range: '2023-至今',
        responsibilities: ['负责用户调研'],
        achievements: ['推动产品上线'],
      }],
      projects: [],
      skills: {hard_skills: ['用户调研'], soft_skills: []},
    };
    const analysis: ResumeAnalysis = {
      quality_score: 75,
      strengths: [],
      weaknesses: [],
      suggestions: [],
      capability_summary: '具备产品经验',
      structured_resume: structuredResume,
    };
    const jdStructure = {
      basic_info: {title: '产品经理', company: '目标公司', location: '长沙'},
      hard_requirements: {required_skills: ['用户调研']},
      responsibilities: ['负责需求分析'],
      tasks: ['访谈客户'],
      soft_skills: ['跨团队协作'],
      nice_to_have: [],
      company_context: {
        explicit_signals: ['服务海外客户'],
        inferred_talent_preferences: ['重视客户洞察'],
        inference_basis: ['JD 明示服务海外客户'],
        confidence: 'medium' as const,
      },
    };

    test('normalizes final-v3 matching fields for the result pages', async () => {
      mockPost.mockResolvedValue({
        match_score: 82,
        hard_requirements_match: {'用户调研': true},
        skill_match: {matched: ['用户调研'], missing: []},
        experience_match: '具备用户调研经验',
        soft_skills_match: '协作能力需要面试确认',
        strengths: ['用户调研经验'],
        weaknesses: ['跨团队协作证据不足'],
        weakness_details: [{
          id: 'G1',
          priority: 'high',
          weakness: '跨团队协作证据不足',
          evidence_type: 'wording_gap',
          jd_requirement: '跨团队协作推进需求落地',
          evidence: '源简历未显式描述协作对象',
          impact: '岗位关键协作能力不够醒目',
          suggestion: '仅在有真实证据时补充协作对象',
        }],
        positioning_strategy: '突出用户调研到产品落地的链路',
        optimization_suggestions: ['旧版摘要应被结构化策略覆盖'],
        optimization_strategy_details: [{
          id: 'S1',
          related_gap_ids: ['G1'],
          strategy_point: '前置用户调研证据',
          rationale: '直接回应岗位的调研优先级',
          optimization_example: {
            source_path: 'experience[0].responsibilities[0]',
            source_quote: '负责用户调研',
            optimized_content: '围绕用户调研推进需求落地',
          },
        }],
        context_fit: {
          company_alignment: '客户洞察方向相关',
          location_alignment: '待面试确认',
          hypotheses_used: ['重视客户洞察'],
        },
        jd_structure: jdStructure,
      });

      const result = await resumeApi.matchResume(
        analysis,
        '目标岗位负责用户调研、需求分析和产品方案落地',
      );

      expect(result.positioning_strategy).toBe('突出用户调研到产品落地的链路');
      expect(result.optimization_suggestions).toEqual(['前置用户调研证据']);
      expect(result.weakness_details?.[0]).toMatchObject({
        id: 'G1',
        priority: 'high',
        jd_requirement: '跨团队协作推进需求落地',
        impact: '岗位关键协作能力不够醒目',
      });
      expect(result.optimization_strategy_details?.[0]).toMatchObject({
        id: 'S1',
        related_gap_ids: ['G1'],
        strategy_point: '前置用户调研证据',
        optimization_example: {
          source_quote: '负责用户调研',
          optimized_content: '围绕用户调研推进需求落地',
        },
      });
      expect(result.context_fit?.hypotheses_used).toEqual(['重视客户洞察']);
      expect(result.jd_structure?.company_context?.confidence).toBe('medium');
    });

    test('converts normalized matching data back to the backend contract', async () => {
      const matching: MatchingResult = {
        match_score: 82,
        hard_requirements_match: [{requirement: '用户调研', matched: true}],
        skill_match: {
          matched_skills: ['用户调研'],
          missing_skills: [],
          match_percentage: 82,
        },
        experience_match: {
          years_required: 0,
          years_actual: 0,
          relevant_experience: ['具备用户调研经验'],
          match_percentage: 82,
        },
        optimization_suggestions: ['前置用户调研证据'],
        optimization_strategy_details: [{
          id: 'S1',
          related_gap_ids: ['G1'],
          strategy_point: '前置用户调研证据',
          rationale: '回应岗位调研优先级',
          optimization_example: {
            source_path: 'experience[0].responsibilities[0]',
            source_quote: '负责用户调研',
            optimized_content: '围绕用户调研推进需求落地',
          },
        }],
        positioning_strategy: '突出用户调研到产品落地的链路',
        jd_structure: jdStructure,
      };
      mockPost.mockResolvedValue({
        optimized_resume: '# 张三\n\n## 工作经历\n...',
        changes_summary: [],
        improvement_score: 7,
      });

      await resumeApi.generateOptimizedResume(analysis, matching);

      expect(mockPost).toHaveBeenCalledWith(
        '/mvp/generate',
        {
          structured_resume: structuredResume,
          matching: expect.objectContaining({
            hard_requirements_match: {'用户调研': true},
            skill_match: {matched: ['用户调研'], missing: []},
            experience_match: '具备用户调研经验',
            positioning_strategy: '突出用户调研到产品落地的链路',
            optimization_strategy_details: matching.optimization_strategy_details,
            jd_structure: jdStructure,
          }),
        },
        {timeout: 90000},
      );
    });
  });

  describe('processResume', () => {
    const sampleResume = `# 张三

## 工作经历
### 软件工程师 | ABC 公司 | 2020-2023
- 负责后端开发`;

    const sampleJD = `岗位名称：后端开发工程师

岗位职责：
1. 负责后端服务开发
2. 参与系统架构设计

任职要求：
1. 3 年以上后端开发经验
2. 精通 Node.js 或 Python`;

    const mockProcessResponse = {
      step1_analysis: {
        quality_score: 75,
        strengths: ['工作经历清晰'],
        weaknesses: ['缺少项目经验'],
        suggestions: ['添加项目案例'],
        capability_summary: '3 年后端开发经验',
        structured_resume: {
          personal_info: {name: '张三'},
          education: [],
          experience: [],
          projects: [],
          skills: {hard_skills: [], soft_skills: []},
        },
      } as ResumeAnalysis,
      step2_matching: {
        match_score: 80,
        hard_requirements_match: [
          {
            requirement: '3 年以上后端开发经验',
            matched: true,
            evidence: '2020-2023 在 ABC 公司担任软件工程师',
          },
        ],
        skill_match: {
          matched_skills: ['后端开发'],
          missing_skills: ['Node.js', 'Python'],
          match_percentage: 50,
        },
        experience_match: {
          years_required: 3,
          years_actual: 3,
          relevant_experience: ['后端开发'],
          match_percentage: 100,
        },
        optimization_suggestions: ['突出后端开发经验', '添加技术栈描述'],
      } as MatchingResult,
      step3_optimized_resume: `# 张三

## 工作经历
### 高级软件工程师 | ABC 公司 | 2020-2023
- 负责后端服务开发，支持日均 10 万+ 请求
- 参与系统架构设计，提升系统性能 50%`,
    };

    test('should process resume successfully', async () => {
      // Mock API 响应
      mockPost.mockResolvedValue(mockProcessResponse);

      // 调用方法
      const result = await resumeApi.processResume(sampleResume, sampleJD);

      // 验证 API 调用
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPost).toHaveBeenCalledWith('/mvp/process', {
        resume_markdown: sampleResume,
        jd_text: sampleJD,
      });

      // 验证返回结果结构
      expect(result).toHaveProperty('analysis');
      expect(result).toHaveProperty('matching');
      expect(result).toHaveProperty('optimized');

      // 验证分析结果
      expect(result.analysis.quality_score).toBe(75);
      expect(result.analysis.strengths).toHaveLength(1);

      // 验证匹配结果
      expect(result.matching.match_score).toBe(80);
      expect(result.matching.hard_requirements_match).toHaveLength(1);

      // 验证优化结果
      expect(result.optimized.optimized_resume).toContain('高级软件工程师');
      expect(result.optimized.changes_summary).toEqual(
        mockProcessResponse.step2_matching.optimization_suggestions,
      );
      expect(result.optimized.improvement_score).toBe(5); // 80 - 75
    });

    test('should throw error when resume is empty', async () => {
      await expect(resumeApi.processResume('', sampleJD)).rejects.toThrow(
        '简历内容不能为空且至少需要 10 个字符',
      );

      // 不应该调用 API
      expect(mockPost).not.toHaveBeenCalled();
    });

    test('should throw error when JD is empty', async () => {
      await expect(resumeApi.processResume(sampleResume, '')).rejects.toThrow(
        'JD 内容不能为空且至少需要 10 个字符',
      );

      // 不应该调用 API
      expect(mockPost).not.toHaveBeenCalled();
    });

    test('should throw error when resume is too short', async () => {
      await expect(resumeApi.processResume('短', sampleJD)).rejects.toThrow(
        '简历内容不能为空且至少需要 10 个字符',
      );
    });

    test('should throw error when JD is too short', async () => {
      await expect(resumeApi.processResume(sampleResume, '短')).rejects.toThrow(
        'JD 内容不能为空且至少需要 10 个字符',
      );
    });

    test('should throw error when both are empty', async () => {
      await expect(resumeApi.processResume('', '')).rejects.toThrow(
        '简历内容不能为空且至少需要 10 个字符',
      );
    });

    test('should handle API error', async () => {
      // Mock API 错误
      const apiError = new RequestError('处理失败', 'PROCESS_FAILED', 500);
      mockPost.mockRejectedValue(apiError);

      // 调用方法并验证错误
      await expect(
        resumeApi.processResume(sampleResume, sampleJD),
      ).rejects.toThrow(apiError);

      // 验证 API 被调用
      expect(mockPost).toHaveBeenCalledTimes(1);
    });

    test('should handle network timeout', async () => {
      // Mock 超时错误
      const timeoutError = new RequestError('请求超时', 'TIMEOUT');
      mockPost.mockRejectedValue(timeoutError);

      // 调用方法并验证错误
      await expect(
        resumeApi.processResume(sampleResume, sampleJD),
      ).rejects.toThrow(timeoutError);
    });

    test('should accept minimum valid input lengths', async () => {
      // Mock API 响应
      mockPost.mockResolvedValue(mockProcessResponse);

      // 最小有效长度（10 个字符）
      const minResume = '1234567890';
      const minJD = 'abcdefghij';

      await resumeApi.processResume(minResume, minJD);

      // 验证 API 被调用
      expect(mockPost).toHaveBeenCalledWith('/mvp/process', {
        resume_markdown: minResume,
        jd_text: minJD,
      });
    });

    test('should calculate improvement score correctly', async () => {
      // Mock 不同的评分
      const customResponse = {
        ...mockProcessResponse,
        step1_analysis: {
          ...mockProcessResponse.step1_analysis,
          quality_score: 60,
        },
        step2_matching: {
          ...mockProcessResponse.step2_matching,
          match_score: 85,
        },
      };

      mockPost.mockResolvedValue(customResponse);

      const result = await resumeApi.processResume(sampleResume, sampleJD);

      // 验证改进分数计算：85 - 60 = 25
      expect(result.optimized.improvement_score).toBe(25);
    });

    test('should handle negative improvement score', async () => {
      // Mock 匹配度低于质量分的情况
      const customResponse = {
        ...mockProcessResponse,
        step1_analysis: {
          ...mockProcessResponse.step1_analysis,
          quality_score: 90,
        },
        step2_matching: {
          ...mockProcessResponse.step2_matching,
          match_score: 70,
        },
      };

      mockPost.mockResolvedValue(customResponse);

      const result = await resumeApi.processResume(sampleResume, sampleJD);

      // 验证改进分数可以为负：70 - 90 = -20
      expect(result.optimized.improvement_score).toBe(-20);
    });

    test('should normalize missing optional list fields from process response', async () => {
      const responseWithMissingLists = {
        ...mockProcessResponse,
        step1_analysis: {
          ...mockProcessResponse.step1_analysis,
          strengths: undefined,
          weaknesses: undefined,
          suggestions: undefined,
        },
        step2_matching: {
          ...mockProcessResponse.step2_matching,
          optimization_suggestions: undefined,
          skill_match: undefined,
          experience_match: undefined,
        },
      };

      mockPost.mockResolvedValue(responseWithMissingLists);

      const result = await resumeApi.processResume(sampleResume, sampleJD);

      expect(result.analysis.strengths).toEqual([]);
      expect(result.analysis.weaknesses).toEqual([]);
      expect(result.analysis.suggestions).toEqual([]);
      expect(result.matching.optimization_suggestions).toEqual([]);
      expect(result.matching.skill_match.matched_skills).toEqual([]);
      expect(result.matching.experience_match.relevant_experience).toEqual([]);
      expect(result.optimized.changes_summary).toEqual([]);
    });
  });

  describe('ResumeApi instance', () => {
    test('should create new instance', () => {
      const api = new ResumeApi();
      expect(api).toBeInstanceOf(ResumeApi);
    });

    test('should have analyzeResume method', () => {
      const api = new ResumeApi();
      expect(typeof api.analyzeResume).toBe('function');
    });

    test('should have processResume method', () => {
      const api = new ResumeApi();
      expect(typeof api.processResume).toBe('function');
    });
  });
});
