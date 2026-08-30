import {create} from 'zustand';
import type {LoadOptions, SourceResumeState} from './types';
import type {SourceResumeSummary} from '@/types';
import {sourceResumeApi} from '@/services/sourceResume';
import {isLocalRuntimeEnvironment} from '@/services/runtime-config';
import {useAuthStore} from './authStore';
import {getJSON, setJSON, storage} from '@/utils/storage';
import {getUserStorageKey, SOURCE_RESUME_STORAGE_KEY} from '@/utils/user-data-storage';
import {PENDING_LANDING_SOURCE_RESUME_KEY} from '@/utils/pending-landing-data';

let loadLatestSourceResumePromise: Promise<void> | null = null;
let sourceResumeStoreEpoch = 0;

function getSourceResumeStorageKey() {
  const userId = useAuthStore.getState().session?.user.id;
  return getUserStorageKey(SOURCE_RESUME_STORAGE_KEY, userId);
}

async function removeSourceResumeCache(storageKey: string) {
  try {
    await Promise.all([
      storage.removeItem(storageKey),
      storageKey === SOURCE_RESUME_STORAGE_KEY
        ? Promise.resolve()
        : storage.removeItem(SOURCE_RESUME_STORAGE_KEY),
    ]);
  } catch (error) {
    console.warn('[SourceResumeStore] Failed to remove obsolete local cache:', error);
  }
}

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
      const operationEpoch = sourceResumeStoreEpoch;
      const storageKey = getSourceResumeStorageKey();
      const isGuest = !Boolean(useAuthStore.getState().session);
      set(state => ({
        loading: {
          ...state.loading,
          isLoading: true,
          error: null,
        },
      }));

      const allowLocalFallback = isGuest || await isLocalRuntimeEnvironment();
      let cachedResume: SourceResumeSummary | null = null;

      if (operationEpoch !== sourceResumeStoreEpoch) {
        return;
      }

      if (allowLocalFallback) {
        try {
          const [storedResume, pendingLandingResume] = await Promise.all([
            getJSON<SourceResumeSummary>(storageKey),
            isGuest
              ? getJSON<SourceResumeSummary>(PENDING_LANDING_SOURCE_RESUME_KEY)
              : Promise.resolve(null),
          ]);
          // Landing pending resume is latest guest selection and takes priority
          // over an older generic cache.
          cachedResume = pendingLandingResume || storedResume;
          if (operationEpoch !== sourceResumeStoreEpoch) {
            return;
          }
          if (cachedResume) {
            set({latestSourceResume: cachedResume});
          }
        } catch (error) {
          console.warn('[SourceResumeStore] Failed to read cached source resume:', error);
        }
      }

      if (isGuest) {
        if (operationEpoch !== sourceResumeStoreEpoch) {
          return;
        }

        set({
          latestSourceResume: cachedResume,
          loading: {
            isLoading: false,
            error: null,
          },
          initialized: true,
        });
        return;
      }

      try {
        const latestResume = await sourceResumeApi.getLatestSourceResume();

        if (operationEpoch !== sourceResumeStoreEpoch) {
          return;
        }

        if (allowLocalFallback && latestResume) {
          await setJSON(storageKey, latestResume);
        } else if (allowLocalFallback) {
          await storage.removeItem(storageKey);
        } else {
          await removeSourceResumeCache(storageKey);
        }

        if (operationEpoch !== sourceResumeStoreEpoch) {
          return;
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
        if (operationEpoch !== sourceResumeStoreEpoch) {
          return;
        }

        const errorMessage =
          error instanceof Error ? error.message : '加载源简历失败';

        set(state => ({
          latestSourceResume: allowLocalFallback
            ? cachedResume ?? state.latestSourceResume
            : null,
          loading: {
            ...state.loading,
            isLoading: false,
            error: allowLocalFallback && cachedResume ? null : errorMessage,
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
    const operationEpoch = sourceResumeStoreEpoch;
    const storageKey = getSourceResumeStorageKey();
    const allowLocalFallback = await isLocalRuntimeEnvironment();

    if (allowLocalFallback && resume) {
      await setJSON(storageKey, resume);
    } else if (allowLocalFallback) {
      await storage.removeItem(storageKey);
    } else {
      await removeSourceResumeCache(storageKey);
    }

    if (operationEpoch !== sourceResumeStoreEpoch) {
      return;
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
    const operationEpoch = sourceResumeStoreEpoch;
    const storageKey = getSourceResumeStorageKey();
    await sourceResumeApi.deleteSourceResume(id);
    await removeSourceResumeCache(storageKey);
    if (operationEpoch !== sourceResumeStoreEpoch) {
      return;
    }
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
    const operationEpoch = sourceResumeStoreEpoch;
    await removeSourceResumeCache(getSourceResumeStorageKey());
    if (operationEpoch !== sourceResumeStoreEpoch) {
      return;
    }
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
    sourceResumeStoreEpoch += 1;
    loadLatestSourceResumePromise = null;
    set(initialState);
  },
}));
