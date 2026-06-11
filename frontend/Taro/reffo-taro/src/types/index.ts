// 类型定义

// ============ 历史记录 ============

export interface ResumeHistory {
  id: string;
  position: string; // 岗位名称
  company: string; // 公司名称
  name: string; // 姓名
  createdAt: string; // 创建时间（主成就日期）
  qualityScore: number; // 质量评分 0-100
  matchScore: number; // 匹配度 0-100
  tags: string[]; // 标签（技能、领域等）
  resumeContent: string; // 原始简历内容
  jdContent: string; // JD 内容
  optimizedContent: string; // 优化后的简历
  cardColor?: string; // 卡片背景色
  cardPattern?: string; // 卡片图案类型
}

// ============ API 响应 ============

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

// ============ 简历分析 ============

export interface ResumeAnalysis {
  quality_score: number;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  capability_summary: string;
  structured_resume: StructuredResume;
}

export interface StructuredResume {
  personal_info: PersonalInfo;
  education: Education[];
  experience: WorkExperience[];
  projects: Project[];
  skills: Skills;
}

export interface PersonalInfo {
  name: string;
  email?: string;
  phone?: string;
  location?: string;
  github?: string;
  linkedin?: string;
}

export interface Education {
  school: string;
  degree: string;
  major: string;
  start_date: string;
  end_date: string;
  gpa?: string;
  achievements?: string[];
}

export interface WorkExperience {
  company: string;
  position: string;
  start_date: string;
  end_date: string;
  responsibilities: string[];
  achievements: string[];
}

export interface Project {
  name: string;
  description: string;
  tech_stack: string[];
  role: string;
  achievements: string[];
  url?: string;
}

export interface Skills {
  hard_skills: string[];
  soft_skills: string[];
  languages?: string[];
  certifications?: string[];
}

// ============ 匹配结果 ============

export interface MatchingResult {
  match_score: number;
  hard_requirements_match: HardRequirement[];
  skill_match: SkillMatch;
  experience_match: ExperienceMatch;
  optimization_suggestions: string[];
}

export interface HardRequirement {
  requirement: string;
  matched: boolean;
  evidence?: string;
  suggestion?: string;
}

export interface SkillMatch {
  matched_skills: string[];
  missing_skills: string[];
  match_percentage: number;
}

export interface ExperienceMatch {
  years_required: number;
  years_actual: number;
  relevant_experience: string[];
  match_percentage: number;
}

// ============ 优化结果 ============

export interface OptimizedResume {
  optimized_resume: string;
  changes_summary: string[];
  improvement_score: number;
}

// ============ 完整处理结果 ============

export interface ProcessResult {
  analysis: ResumeAnalysis;
  matching: MatchingResult;
  optimized: OptimizedResume;
}

export type SourceResumeSourceType = 'manual' | 'file';

export interface SourceResumeSummary {
  id: string;
  title: string;
  resumeMarkdown: string;
  sourceType: SourceResumeSourceType;
  originalFileName: string | null;
  createdAt: string;
  updatedAt: string;
}
