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

let restoreSessionPromise: Promise<AuthSession | null> | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  initialized: false,
  loading: false,
  error: null,

  restoreSession: async () => {
    if (get().initialized) {
      return get().session;
    }

    if (restoreSessionPromise) {
      return restoreSessionPromise;
    }

    set({loading: true, error: null});

    restoreSessionPromise = (async () => {
      try {
        const session = await authApi.restoreSession();
        set({session, initialized: true, loading: false});
        return session;
      } catch (error) {
        const message = error instanceof Error ? error.message : '恢复登录态失败';
        set({session: null, initialized: true, loading: false, error: message});
        return null;
      }
    })().finally(() => {
      restoreSessionPromise = null;
    });

    return restoreSessionPromise;
  },

  signInWithPassword: async (input: SignInWithPasswordInput) => {
    set({loading: true, error: null});

    try {
      const session = await authApi.signInWithPassword(input);
      restoreSessionPromise = null;
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
      restoreSessionPromise = null;
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
