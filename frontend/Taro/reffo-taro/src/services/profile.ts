import {apiClient} from './api'

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
  async getProfile() {
    return apiClient.get<UserProfile>('/profile/')
  }

  async getQuota() {
    return apiClient.get<ResumeQuota>('/profile/quota')
  }
}

export const profileApi = new ProfileApi()
