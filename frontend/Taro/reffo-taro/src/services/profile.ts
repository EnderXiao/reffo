import {apiClient} from './api'

export interface UserProfile {
  id: string
  displayName: string | null
  avatarUrl: string
  createdAt: string | null
  updatedAt: string | null
}

export class ProfileApi {
  async getProfile() {
    return apiClient.get<UserProfile>('/profile/')
  }
}

export const profileApi = new ProfileApi()
