/**
 * Resume Store 单元测试
 */

import {describe, test, expect, beforeEach} from '@jest/globals';
import {useResumeStore} from '../resumeStore';
import type {ResumeAnalysis} from '@/types';

describe('useResumeStore', () => {
  // 在每个测试前重置 store
  beforeEach(() => {
    useResumeStore.getState().reset();
  });

  describe('初始状态', () => {
    test('应该有正确的初始值', () => {
      const state = useResumeStore.getState();

      expect(state.resumeContent).toBe('');
      expect(state.analysis).toBeNull();
      expect(state.loading.isLoading).toBe(false);
      expect(state.loading.error).toBeNull();
    });
  });

  describe('setResumeContent', () => {
    test('应该正确设置简历内容', () => {
      const testContent = '# 张三\n\n## 工作经历\n...';

      useResumeStore.getState().setResumeContent(testContent);

      expect(useResumeStore.getState().resumeContent).toBe(testContent);
    });

    test('应该能够更新已有的简历内容', () => {
      useResumeStore.getState().setResumeContent('旧内容');
      expect(useResumeStore.getState().resumeContent).toBe('旧内容');

      useResumeStore.getState().setResumeContent('新内容');
      expect(useResumeStore.getState().resumeContent).toBe('新内容');
    });

    test('应该能够设置空字符串', () => {
      useResumeStore.getState().setResumeContent('有内容');
      useResumeStore.getState().setResumeContent('');

      expect(useResumeStore.getState().resumeContent).toBe('');
    });
  });

  describe('setAnalysis', () => {
    test('应该正确设置分析结果', () => {
      const mockAnalysis: ResumeAnalysis = {
        quality_score: 85,
        strengths: ['优势1', '优势2'],
        weaknesses: ['问题1'],
        suggestions: ['建议1', '建议2'],
        capability_summary: '能力总结',
        structured_resume: {
          personal_info: {
            name: '张三',
            email: 'zhangsan@example.com',
          },
          education: [],
          experience: [],
          projects: [],
          skills: {
            hard_skills: ['JavaScript', 'TypeScript'],
            soft_skills: ['沟通能力'],
          },
        },
      };

      useResumeStore.getState().setAnalysis(mockAnalysis);

      const state = useResumeStore.getState();
      expect(state.analysis).toEqual(mockAnalysis);
      expect(state.analysis?.quality_score).toBe(85);
      expect(state.analysis?.strengths).toHaveLength(2);
    });

    test('应该能够清空分析结果', () => {
      const mockAnalysis: ResumeAnalysis = {
        quality_score: 85,
        strengths: [],
        weaknesses: [],
        suggestions: [],
        capability_summary: '',
        structured_resume: {
          personal_info: {name: '张三'},
          education: [],
          experience: [],
          projects: [],
          skills: {hard_skills: [], soft_skills: []},
        },
      };

      useResumeStore.getState().setAnalysis(mockAnalysis);
      expect(useResumeStore.getState().analysis).not.toBeNull();

      useResumeStore.getState().setAnalysis(null);
      expect(useResumeStore.getState().analysis).toBeNull();
    });
  });

  describe('setLoading', () => {
    test('应该正确设置加载状态为 true', () => {
      useResumeStore.getState().setLoading(true);

      const state = useResumeStore.getState();
      expect(state.loading.isLoading).toBe(true);
      expect(state.loading.error).toBeNull();
    });

    test('应该正确设置加载状态为 false', () => {
      useResumeStore.getState().setLoading(true);
      useResumeStore.getState().setLoading(false);

      expect(useResumeStore.getState().loading.isLoading).toBe(false);
    });

    test('设置加载状态不应影响错误信息', () => {
      useResumeStore.getState().setError('测试错误');
      useResumeStore.getState().setLoading(true);

      const state = useResumeStore.getState();
      expect(state.loading.isLoading).toBe(true);
      expect(state.loading.error).toBe('测试错误');
    });
  });

  describe('setError', () => {
    test('应该正确设置错误信息', () => {
      const errorMessage = '分析失败：网络错误';

      useResumeStore.getState().setError(errorMessage);

      const state = useResumeStore.getState();
      expect(state.loading.error).toBe(errorMessage);
      expect(state.loading.isLoading).toBe(false);
    });

    test('应该能够清空错误信息', () => {
      useResumeStore.getState().setError('错误信息');
      expect(useResumeStore.getState().loading.error).toBe('错误信息');

      useResumeStore.getState().setError(null);
      expect(useResumeStore.getState().loading.error).toBeNull();
    });

    test('设置错误不应影响加载状态', () => {
      useResumeStore.getState().setLoading(true);
      useResumeStore.getState().setError('错误');

      const state = useResumeStore.getState();
      expect(state.loading.isLoading).toBe(true);
      expect(state.loading.error).toBe('错误');
    });
  });

  describe('reset', () => {
    test('应该重置所有状态到初始值', () => {
      const mockAnalysis: ResumeAnalysis = {
        quality_score: 85,
        strengths: [],
        weaknesses: [],
        suggestions: [],
        capability_summary: '',
        structured_resume: {
          personal_info: {name: '张三'},
          education: [],
          experience: [],
          projects: [],
          skills: {hard_skills: [], soft_skills: []},
        },
      };

      // 设置一些状态
      useResumeStore.getState().setResumeContent('测试内容');
      useResumeStore.getState().setAnalysis(mockAnalysis);
      useResumeStore.getState().setLoading(true);
      useResumeStore.getState().setError('测试错误');

      // 验证状态已改变
      let state = useResumeStore.getState();
      expect(state.resumeContent).toBe('测试内容');
      expect(state.analysis).not.toBeNull();
      expect(state.loading.isLoading).toBe(true);
      expect(state.loading.error).toBe('测试错误');

      // 重置
      useResumeStore.getState().reset();

      // 验证已重置到初始状态
      state = useResumeStore.getState();
      expect(state.resumeContent).toBe('');
      expect(state.analysis).toBeNull();
      expect(state.loading.isLoading).toBe(false);
      expect(state.loading.error).toBeNull();
    });
  });

  describe('完整工作流', () => {
    test('应该支持完整的分析流程', () => {
      const mockAnalysis: ResumeAnalysis = {
        quality_score: 90,
        strengths: ['经验丰富', '技能全面'],
        weaknesses: ['缺少量化数据'],
        suggestions: ['添加具体数字'],
        capability_summary: '资深开发者',
        structured_resume: {
          personal_info: {name: '李四'},
          education: [],
          experience: [],
          projects: [],
          skills: {hard_skills: ['React', 'Node.js'], soft_skills: []},
        },
      };

      // 1. 设置简历内容
      useResumeStore
        .getState()
        .setResumeContent('# 李四\n\n## 技能\n- React\n- Node.js');
      expect(useResumeStore.getState().resumeContent).toContain('李四');

      // 2. 开始加载
      useResumeStore.getState().setLoading(true);
      expect(useResumeStore.getState().loading.isLoading).toBe(true);

      // 3. 设置分析结果
      useResumeStore.getState().setAnalysis(mockAnalysis);
      useResumeStore.getState().setLoading(false);

      let state = useResumeStore.getState();
      expect(state.analysis?.quality_score).toBe(90);
      expect(state.loading.isLoading).toBe(false);

      // 4. 重置准备下一次分析
      useResumeStore.getState().reset();

      state = useResumeStore.getState();
      expect(state.resumeContent).toBe('');
      expect(state.analysis).toBeNull();
    });

    test('应该支持错误处理流程', () => {
      // 1. 设置简历内容
      useResumeStore.getState().setResumeContent('测试简历');

      // 2. 开始加载
      useResumeStore.getState().setLoading(true);
      useResumeStore.getState().setError(null); // 清空之前的错误

      // 3. 发生错误
      useResumeStore.getState().setError('网络请求失败');
      useResumeStore.getState().setLoading(false);

      let state = useResumeStore.getState();
      expect(state.loading.error).toBe('网络请求失败');
      expect(state.loading.isLoading).toBe(false);
      expect(state.analysis).toBeNull();

      // 4. 清空错误重试
      useResumeStore.getState().setError(null);
      useResumeStore.getState().setLoading(true);

      state = useResumeStore.getState();
      expect(state.loading.error).toBeNull();
      expect(state.loading.isLoading).toBe(true);
    });
  });

  describe('边界情况', () => {
    test('应该处理非常长的简历内容', () => {
      const longContent = '# 简历\n' + '工作经历\n'.repeat(10000);

      useResumeStore.getState().setResumeContent(longContent);

      const state = useResumeStore.getState();
      expect(state.resumeContent).toBe(longContent);
      expect(state.resumeContent.length).toBeGreaterThan(50000);
    });

    test('应该处理包含特殊字符的内容', () => {
      const specialContent =
        '# 张三 👨‍💻\n\n## 技能\n- C++ / C# / JavaScript\n- 😊 emoji';

      useResumeStore.getState().setResumeContent(specialContent);

      const state = useResumeStore.getState();
      expect(state.resumeContent).toBe(specialContent);
      expect(state.resumeContent).toContain('👨‍💻');
      expect(state.resumeContent).toContain('😊');
    });

    test('应该处理快速连续的状态更新', () => {
      useResumeStore.getState().setLoading(true);
      useResumeStore.getState().setLoading(false);
      useResumeStore.getState().setLoading(true);
      useResumeStore.getState().setError('错误1');
      useResumeStore.getState().setError('错误2');
      useResumeStore.getState().setError(null);

      const state = useResumeStore.getState();
      expect(state.loading.isLoading).toBe(true);
      expect(state.loading.error).toBeNull();
    });
  });
});
