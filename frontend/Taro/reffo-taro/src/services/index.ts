/**
 * 服务层统一导出
 *
 * 提供所有 API 服务的统一入口
 */

// API 客户端
export {ApiClient, apiClient} from './api';
export type {ApiResponse, ApiConfig} from './api';

// Auth API
export {AuthApi, authApi} from './auth';
export type {AuthSession, SignInWithPasswordInput} from './auth';

// 运行时公开配置
export {
  getPublicRuntimeConfig,
  getSupabasePublicConfig,
  resetPublicRuntimeConfigCache,
} from './runtime-config';
export type {PublicRuntimeConfig, SupabasePublicConfig} from './runtime-config';

// 简历 API
export {ResumeApi, resumeApi} from './resume';
export type {
  AnalyzeResumeRequest,
  AnalyzeResumeResponse,
  ProcessResumeRequest,
  ProcessResumeResponse,
} from './resume';

// 文件解析 API
export {ParseApi, parseApi} from './parse';
export type {
  ParsedDocumentResult,
  ParsedJobDescriptionResult,
} from './parse';
