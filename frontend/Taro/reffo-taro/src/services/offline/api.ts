export class OfflineApiClient {
  getAuthToken() {
    return null
  }

  setAuthToken(_token: string | null) {}

  async get<T>(_path: string): Promise<T> {
    throw new Error('离线小工具不支持服务端请求')
  }

  async post<T>(_path: string, _payload?: unknown): Promise<T> {
    throw new Error('离线小工具不支持服务端请求')
  }

  async put<T>(_path: string, _payload?: unknown): Promise<T> {
    throw new Error('离线小工具不支持服务端请求')
  }

  async delete<T>(_path: string): Promise<T> {
    throw new Error('离线小工具不支持服务端请求')
  }
}

export const apiClient = new OfflineApiClient()
