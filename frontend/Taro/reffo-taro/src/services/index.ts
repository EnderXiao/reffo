/**
 * 服务层统一导出
 *
 * 提供所有 API 服务的统一入口
 */

// API 客户端
export {ApiClient, apiClient} from './api';
export type {ApiResponse, ApiConfig} from './api';

// 简历 API
export {ResumeApi, resumeApi} from './resume';
export type {
  AnalyzeResumeRequest,
  AnalyzeResumeResponse,
  ProcessResumeRequest,
  ProcessResumeResponse,
} from './resume';
