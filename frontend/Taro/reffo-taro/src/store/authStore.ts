import {create} from 'zustand';
import {authApi, type AuthSession, type SignInWithPasswordInput} from '@/services/auth';

interface AuthState {
  session: AuthSession | null;
  initialized: boolean;
  loading: boolean;
  error: string | null;
  restoreSession: () => Promise<AuthSession | null>;
  signInWithPassword: (input: SignInWithPasswordInput) => Promise<AuthSession>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  initialized: false,
  loading: false,
  error: null,

  restoreSession: async () => {
    set({loading: true, error: null});

    try {
      const session = await authApi.restoreSession();
      set({session, initialized: true, loading: false});
      return session;
    } catch (error) {
      const message = error instanceof Error ? error.message : '恢复登录态失败';
      set({session: null, initialized: true, loading: false, error: message});
      return null;
    }
  },

  signInWithPassword: async (input: SignInWithPasswordInput) => {
    set({loading: true, error: null});

    try {
      const session = await authApi.signInWithPassword(input);
      set({session, initialized: true, loading: false});
      return session;
    } catch (error) {
      const message = error instanceof Error ? error.message : '登录失败';
      set({loading: false, error: message});
      throw error;
    }
  },

  signOut: async () => {
    set({loading: true, error: null});

    try {
      await authApi.signOut();
      set({session: null, initialized: true, loading: false});
    } catch (error) {
      const message = error instanceof Error ? error.message : '退出登录失败';
      set({loading: false, error: message});
      throw error;
    }
  },

  clearError: () => {
    set({error: null});
  },
}));
