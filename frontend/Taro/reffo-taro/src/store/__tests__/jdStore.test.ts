/**
 * JD Store 单元测试
 *
 * **验证需求: Requirements 6.2**
 */

import {describe, test, expect, beforeEach} from '@jest/globals';
import {useJDStore} from '../jdStore';
import type {MatchingResult} from '@/types';

describe('useJDStore', () => {
  // 在每个测试前重置 store
  beforeEach(() => {
    useJDStore.getState().reset();
  });

  describe('初始状态', () => {
    test('应该有正确的初始值', () => {
      const state = useJDStore.getState();

      expect(state.jdContent).toBe('');
      expect(state.matching).toBeNull();
      expect(state.loading.isLoading).toBe(false);
      expect(state.loading.error).toBeNull();
    });
  });

  describe('setJDContent', () => {
    test('应该正确设置 JD 内容', () => {
      const jdContent = `岗位名称：高级前端开发工程师

岗位职责：
1. 负责前端架构设计和开发
2. 优化前端性能
3. 带领团队完成项目

任职要求：
1. 5 年以上前端开发经验
2. 精通 React/Vue
3. 熟悉 TypeScript`;

      useJDStore.getState().setJDContent(jdContent);

      expect(useJDStore.getState().jdContent).toBe(jdContent);
    });

    test('应该能够更新已有的 JD 内容', () => {
      useJDStore.getState().setJDContent('旧的 JD 内容');
      expect(useJDStore.getState().jdContent).toBe('旧的 JD 内容');

      useJDStore.getState().setJDContent('新的 JD 内容');
      expect(useJDStore.getState().jdContent).toBe('新的 JD 内容');
    });

    test('应该能够设置空字符串', () => {
      useJDStore.getState().setJDContent('有内容');
      useJDStore.getState().setJDContent('');

      expect(useJDStore.getState().jdContent).toBe('');
    });
  });

  describe('setMatching', () => {
    test('应该正确设置匹配结果', () => {
      const matching: MatchingResult = {
        match_score: 85,
        hard_requirements: {
          matched: ['5 年以上前端经验', '精通 React'],
          missing: ['团队管理经验'],
        },
        skill_match: {
          matched_skills: ['React', 'TypeScript', 'Webpack'],
          missing_skills: ['Vue', 'Docker'],
          skill_score: 80,
        },
        experience_match: {
          relevant_experience: ['前端架构设计', '性能优化'],
          experience_score: 90,
        },
        strengths: ['技术栈匹配度高', '项目经验丰富'],
        weaknesses: ['缺少团队管理经验'],
        optimization_suggestions: ['突出架构设计能力', '补充团队协作经验'],
      };

      useJDStore.getState().setMatching(matching);

      const state = useJDStore.getState();
      expect(state.matching).toEqual(matching);
      expect(state.matching?.match_score).toBe(85);
    });

    test('应该能够清空匹配结果', () => {
      const matching: MatchingResult = {
        match_score: 85,
        hard_requirements: {
          matched: ['要求1'],
          missing: [],
        },
        skill_match: {
          matched_skills: ['技能1'],
          missing_skills: [],
          skill_score: 80,
        },
        experience_match: {
          relevant_experience: ['经验1'],
          experience_score: 90,
        },
        strengths: ['优势1'],
        weaknesses: [],
        optimization_suggestions: ['建议1'],
      };

      useJDStore.getState().setMatching(matching);
      expect(useJDStore.getState().matching).not.toBeNull();

      useJDStore.getState().setMatching(null);
      expect(useJDStore.getState().matching).toBeNull();
    });
  });

  describe('setLoading', () => {
    test('应该正确设置加载状态为 true', () => {
      useJDStore.getState().setLoading(true);

      const state = useJDStore.getState();
      expect(state.loading.isLoading).toBe(true);
      expect(state.loading.error).toBeNull();
    });

    test('应该正确设置加载状态为 false', () => {
      useJDStore.getState().setLoading(true);
      useJDStore.getState().setLoading(false);

      expect(useJDStore.getState().loading.isLoading).toBe(false);
    });

    test('设置加载状态不应影响错误信息', () => {
      useJDStore.getState().setError('测试错误');
      useJDStore.getState().setLoading(true);

      const state = useJDStore.getState();
      expect(state.loading.isLoading).toBe(true);
      expect(state.loading.error).toBe('测试错误');
    });
  });

  describe('setError', () => {
    test('应该正确设置错误信息', () => {
      const errorMessage = 'JD 匹配失败：网络错误';

      useJDStore.getState().setError(errorMessage);

      const state = useJDStore.getState();
      expect(state.loading.error).toBe(errorMessage);
      expect(state.loading.isLoading).toBe(false);
    });

    test('应该能够清空错误信息', () => {
      useJDStore.getState().setError('错误信息');
      expect(useJDStore.getState().loading.error).toBe('错误信息');

      useJDStore.getState().setError(null);
      expect(useJDStore.getState().loading.error).toBeNull();
    });

    test('设置错误不应影响加载状态', () => {
      useJDStore.getState().setLoading(true);
      useJDStore.getState().setError('错误');

      const state = useJDStore.getState();
      expect(state.loading.isLoading).toBe(true);
      expect(state.loading.error).toBe('错误');
    });
  });

  describe('reset', () => {
    test('应该重置所有状态到初始值', () => {
      const matching: MatchingResult = {
        match_score: 85,
        hard_requirements: {
          matched: ['要求1'],
          missing: [],
        },
        skill_match: {
          matched_skills: ['技能1'],
          missing_skills: [],
          skill_score: 80,
        },
        experience_match: {
          relevant_experience: ['经验1'],
          experience_score: 90,
        },
        strengths: ['优势1'],
        weaknesses: [],
        optimization_suggestions: ['建议1'],
      };

      // 设置一些状态
      useJDStore.getState().setJDContent('测试 JD 内容');
      useJDStore.getState().setMatching(matching);
      useJDStore.getState().setLoading(true);
      useJDStore.getState().setError('测试错误');

      // 验证状态已改变
      let state = useJDStore.getState();
      expect(state.jdContent).toBe('测试 JD 内容');
      expect(state.matching).not.toBeNull();
      expect(state.loading.isLoading).toBe(true);
      expect(state.loading.error).toBe('测试错误');

      // 重置
      useJDStore.getState().reset();

      // 验证已重置到初始状态
      state = useJDStore.getState();
      expect(state.jdContent).toBe('');
      expect(state.matching).toBeNull();
      expect(state.loading.isLoading).toBe(false);
      expect(state.loading.error).toBeNull();
    });
  });

  describe('完整工作流', () => {
    test('应该支持完整的 JD 匹配流程', () => {
      const jdContent = '岗位要求：5 年以上经验';
      const matching: MatchingResult = {
        match_score: 85,
        hard_requirements: {
          matched: ['5 年以上经验'],
          missing: [],
        },
        skill_match: {
          matched_skills: ['React'],
          missing_skills: [],
          skill_score: 80,
        },
        experience_match: {
          relevant_experience: ['前端开发'],
          experience_score: 90,
        },
        strengths: ['经验丰富'],
        weaknesses: [],
        optimization_suggestions: ['突出项目经验'],
      };

      // 1. 设置 JD 内容
      useJDStore.getState().setJDContent(jdContent);
      expect(useJDStore.getState().jdContent).toBe(jdContent);

      // 2. 开始匹配（设置加载状态）
      useJDStore.getState().setLoading(true);
      expect(useJDStore.getState().loading.isLoading).toBe(true);

      // 3. 匹配成功
      useJDStore.getState().setMatching(matching);
      useJDStore.getState().setLoading(false);

      let state = useJDStore.getState();
      expect(state.matching).toEqual(matching);
      expect(state.loading.isLoading).toBe(false);

      // 4. 重置准备下一次匹配
      useJDStore.getState().reset();

      state = useJDStore.getState();
      expect(state.jdContent).toBe('');
      expect(state.matching).toBeNull();
    });

    test('应该正确处理匹配失败的情况', () => {
      // 1. 设置 JD 内容
      useJDStore.getState().setJDContent('测试 JD');

      // 2. 开始匹配
      useJDStore.getState().setLoading(true);

      // 3. 匹配失败
      useJDStore.getState().setError('匹配失败：API 错误');
      useJDStore.getState().setLoading(false);

      const state = useJDStore.getState();
      expect(state.loading.error).toBe('匹配失败：API 错误');
      expect(state.loading.isLoading).toBe(false);
      expect(state.matching).toBeNull();
    });
  });

  describe('边界情况', () => {
    test('应该处理非常长的 JD 内容', () => {
      const longJD = '岗位要求：'.repeat(1000);

      useJDStore.getState().setJDContent(longJD);

      const state = useJDStore.getState();
      expect(state.jdContent).toBe(longJD);
      expect(state.jdContent.length).toBeGreaterThanOrEqual(5000);
    });

    test('应该处理包含特殊字符的 JD 内容', () => {
      const specialJD =
        '岗位要求：\n- C++/C# 开发\n- 薪资：20k-30k\n- 地点：北京 👨‍💻';

      useJDStore.getState().setJDContent(specialJD);

      const state = useJDStore.getState();
      expect(state.jdContent).toBe(specialJD);
    });

    test('应该处理匹配分数为 0 的情况', () => {
      const matching: MatchingResult = {
        match_score: 0,
        hard_requirements: {
          matched: [],
          missing: ['所有要求'],
        },
        skill_match: {
          matched_skills: [],
          missing_skills: ['所有技能'],
          skill_score: 0,
        },
        experience_match: {
          relevant_experience: [],
          experience_score: 0,
        },
        strengths: [],
        weaknesses: ['完全不匹配'],
        optimization_suggestions: ['建议重新选择岗位'],
      };

      useJDStore.getState().setMatching(matching);

      expect(useJDStore.getState().matching?.match_score).toBe(0);
    });

    test('应该处理匹配分数为 100 的情况', () => {
      const matching: MatchingResult = {
        match_score: 100,
        hard_requirements: {
          matched: ['所有要求'],
          missing: [],
        },
        skill_match: {
          matched_skills: ['所有技能'],
          missing_skills: [],
          skill_score: 100,
        },
        experience_match: {
          relevant_experience: ['所有经验'],
          experience_score: 100,
        },
        strengths: ['完美匹配'],
        weaknesses: [],
        optimization_suggestions: [],
      };

      useJDStore.getState().setMatching(matching);

      expect(useJDStore.getState().matching?.match_score).toBe(100);
    });
  });
});
