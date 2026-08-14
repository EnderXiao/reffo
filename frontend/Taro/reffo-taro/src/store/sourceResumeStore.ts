import {create} from 'zustand';
import type {LoadOptions, SourceResumeState} from './types';
import type {SourceResumeSummary} from '@/types';
import {sourceResumeApi} from '@/services/sourceResume';
import {getJSON, setJSON, storage} from '@/utils/storage';

const STORAGE_KEY = 'latest_source_resume';
let loadLatestSourceResumePromise: Promise<void> | null = null;

const initialState = {
  latestSourceResume: null,
  loading: {
    isLoading: false,
    error: null,
  },
  initialized: false,
};

export const useSourceResumeStore = create<SourceResumeState>((set, get) => ({
  ...initialState,

  loadLatestSourceResume: async (options: LoadOptions = {}) => {
    if (options.skipIfLoaded && get().initialized && !options.force) {
      return;
    }

    if (loadLatestSourceResumePromise && !options.force) {
      return loadLatestSourceResumePromise;
    }

    loadLatestSourceResumePromise = (async () => {
      set(state => ({
        loading: {
          ...state.loading,
          isLoading: true,
          error: null,
        },
      }));

      let cachedResume: SourceResumeSummary | null = null;

      try {
        cachedResume = await getJSON<SourceResumeSummary>(STORAGE_KEY);
        if (cachedResume) {
          set({latestSourceResume: cachedResume});
        }
      } catch (error) {
        console.warn('[SourceResumeStore] Failed to read cached source resume:', error);
      }

      try {
        const latestResume = await sourceResumeApi.getLatestSourceResume();

        if (latestResume) {
          await setJSON(STORAGE_KEY, latestResume);
        } else {
          await storage.removeItem(STORAGE_KEY);
        }

        set({
          latestSourceResume: latestResume,
          loading: {
            isLoading: false,
            error: null,
          },
          initialized: true,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : '加载源简历失败';

        set(state => ({
          latestSourceResume: cachedResume ?? state.latestSourceResume,
          loading: {
            ...state.loading,
            isLoading: false,
            error: cachedResume ? null : errorMessage,
          },
          initialized: true,
        }));

        console.error('[SourceResumeStore] Failed to load source resume:', error);
      }
    })().finally(() => {
      loadLatestSourceResumePromise = null;
    });

    return loadLatestSourceResumePromise;
  },

  setLatestSourceResume: async (resume: SourceResumeSummary | null) => {
    if (resume) {
      await setJSON(STORAGE_KEY, resume);
    } else {
      await storage.removeItem(STORAGE_KEY);
    }

    set({
      latestSourceResume: resume,
      loading: {
        isLoading: false,
        error: null,
      },
      initialized: true,
    });
  },

  deleteLatestSourceResume: async (id: string) => {
    await sourceResumeApi.deleteSourceResume(id);
    await storage.removeItem(STORAGE_KEY);
    set({
      latestSourceResume: null,
      loading: {
        isLoading: false,
        error: null,
      },
      initialized: true,
    });
  },

  clearLatestSourceResume: async () => {
    await storage.removeItem(STORAGE_KEY);
    set({
      latestSourceResume: null,
      loading: {
        isLoading: false,
        error: null,
      },
      initialized: true,
    });
  },

  reset: () => {
    loadLatestSourceResumePromise = null;
    set(initialState);
  },
}));
