export interface UserProfile {
  id: string
  displayName: string | null
  avatarUrl: string
  createdAt: string | null
  updatedAt: string | null
}

export interface ResumeQuota {
  unlimited: boolean
  limit: number | null
  used: number
  remaining: number | null
}

export class ProfileApi {
  async getProfile(): Promise<UserProfile> {
    throw new Error('离线小工具没有账号资料')
  }

  async getQuota(): Promise<ResumeQuota> {
    return {
      unlimited: true,
      limit: null,
      used: 0,
      remaining: null,
    }
  }
}

export const profileApi = new ProfileApi()
