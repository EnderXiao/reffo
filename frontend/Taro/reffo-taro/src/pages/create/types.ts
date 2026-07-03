export const CREATE_STEP_SEQUENCE = ['resumeUpload', 'resumeSummary', 'jobDescription'] as const

export type CreateStepId = (typeof CREATE_STEP_SEQUENCE)[number]

export type ResumeUploadStatus = 'idle' | 'uploading' | 'success' | 'error'
export type CreateTitleTone = 'default' | 'accent' | 'warm'
export type JobDescriptionInputMode = 'upload' | 'manual'
export type JobDescriptionAttachmentStatus = 'idle' | 'uploading' | 'success' | 'error'

export interface UploadedResumeFile {
  name: string
  path: string
  size: number
  sizeLabel?: string
  extension: string
  extractedText?: string
}

export interface ResumeUploadStepState {
  status: ResumeUploadStatus
  progress: number
  file: UploadedResumeFile | null
  markdown: string
  errorMessage: string | null
}

export interface ResumeSummaryStepState {
  title: string
  fileName: string
  sizeLabel: string | null
  updatedAtLabel: string
  sourceTypeLabel: string
}

export interface UploadedJobDescriptionFile {
  name: string
  path: string
  size: number
  sizeLabel?: string
  extension: string
  previewPath?: string | null
}

export interface JobDescriptionStepState {
  content: string
  companyName: string
  positionName: string
  inputMode: JobDescriptionInputMode
  attachmentStatus: JobDescriptionAttachmentStatus
  attachment: UploadedJobDescriptionFile | null
  attachmentErrorMessage: string | null
}

export interface CreateGenerationState {
  resumeTitle: string
  companyName: string
  positionName: string
  monogram: string
  detailItems: string[]
}

export interface CreateTitleSegment {
  text: string
  tone: CreateTitleTone
}

export interface CreateStepMeta {
  id: CreateStepId
  titleSegments: CreateTitleSegment[]
  description: string
  actionLabel: string
}

export const CREATE_STEP_META: Record<CreateStepId, CreateStepMeta> = {
  resumeUpload: {
    id: 'resumeUpload',
    titleSegments: [
      {text: '编辑', tone: 'default'},
      {text: '源简历', tone: 'accent'},
    ],
    description:
      'Reffo 能够充分理解你的技能模型和工作经验对于针对目标岗位生成最佳简历是非常必要的',
    actionLabel: '保存源简历',
  },
  resumeSummary: {
    id: 'resumeSummary',
    titleSegments: [
      {text: '源简历', tone: 'accent'},
      {text: '文件', tone: 'default'},
    ],
    description:
      'Reffo 能够充分理解你的技能模型和工作经验对于针对目标岗位生成最佳简历是非常必要的',
    actionLabel: '继续创建',
  },
  jobDescription: {
    id: 'jobDescription',
    titleSegments: [
      {text: '新的', tone: 'warm'},
      {text: '申请', tone: 'default'},
    ],
    description: '向 Reffo 描述您期望的职位，然后获取一份为您量身定制的最佳简历！',
    actionLabel: '开始生成最佳简历',
  },
}

export const RESUME_FILE_ACCEPT_TYPES = ['.pdf', '.doc', '.docx', '.md', '.txt'] as const

export const RESUME_FILE_MAX_SIZE_MB = 10
