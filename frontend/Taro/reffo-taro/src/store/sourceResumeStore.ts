import {create} from 'zustand';
import type {LoadOptions, SourceResumeState} from './types';
import type {SourceResumeSummary, SourceResumeSummaryMeta} from '@/types';
import {sourceResumeApi} from '@/services/sourceResume';
import {isLocalRuntimeEnvironment} from '@/services/runtime-config';
import {useAuthStore} from './authStore';
import {getJSON, setJSON, storage} from '@/utils/storage';
import {getUserStorageKey, SOURCE_RESUME_STORAGE_KEY} from '@/utils/user-data-storage';
import {PENDING_LANDING_SOURCE_RESUME_KEY} from '@/utils/pending-landing-data';
import {RequestError} from '@/utils/request';

let loadLatestSourceResumePromise: Promise<void> | null = null;
let loadLatestSourceSummaryPromise: Promise<void> | null = null;
let sourceResumeStoreEpoch = 0;

function toSourceResumeSummaryMetaFromSummary(
  summary: SourceResumeSummary,
): SourceResumeSummaryMeta {
  return {
    id: summary.id,
    title: summary.title,
    sourceType: summary.sourceType,
    originalFileName: summary.originalFileName,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
  };
}

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

async function readCachedSourceResume(storageKey: string, isGuest: boolean) {
  const [storedResume, pendingLandingResume] = await Promise.all([
    getJSON<SourceResumeSummary>(storageKey),
    isGuest
      ? getJSON<SourceResumeSummary>(PENDING_LANDING_SOURCE_RESUME_KEY)
      : Promise.resolve(null),
  ]);

  return pendingLandingResume || storedResume;
}

const initialState = {
  latestSourceResume: null,
  latestSourceResumeSummary: null,
  loading: {
    isLoading: false,
    error: null,
  },
  initialized: false,
  summaryInitialized: false,
};

export const useSourceResumeStore = create<SourceResumeState>((set, get) => ({
  ...initialState,

  loadLatestSourceSummary: async (options: LoadOptions = {}) => {
    if (options.skipIfLoaded && get().summaryInitialized && !options.force) {
      return;
    }

    if (loadLatestSourceSummaryPromise && !options.force) {
      return loadLatestSourceSummaryPromise;
    }

    loadLatestSourceSummaryPromise = (async () => {
      const operationEpoch = sourceResumeStoreEpoch;
      const storageKey = getSourceResumeStorageKey();
      const isGuest = !Boolean(useAuthStore.getState().session);
      const allowLocalFallback = isGuest || await isLocalRuntimeEnvironment();
      let cachedSummary: SourceResumeSummaryMeta | null = null;

      set(state => ({
        loading: {
          ...state.loading,
          isLoading: true,
          error: null,
        },
      }));

      if (allowLocalFallback) {
        try {
          const cachedResume = await readCachedSourceResume(storageKey, isGuest);
          if (operationEpoch !== sourceResumeStoreEpoch) {
            return;
          }

          cachedSummary = cachedResume
            ? toSourceResumeSummaryMetaFromSummary(cachedResume)
            : null;
          if (cachedSummary) {
            set({latestSourceResumeSummary: cachedSummary});
          }
        } catch (error) {
          console.warn('[SourceResumeStore] Failed to read cached source summary:', error);
        }
      }

      if (isGuest) {
        if (operationEpoch !== sourceResumeStoreEpoch) {
          return;
        }

        set({
          latestSourceResumeSummary: cachedSummary,
          loading: {
            isLoading: false,
            error: null,
          },
          summaryInitialized: true,
        });
        return;
      }

      try {
        const latestSummary = await sourceResumeApi.getLatestSourceResumeSummary();
        if (operationEpoch !== sourceResumeStoreEpoch) {
          return;
        }

        set({
          latestSourceResumeSummary: latestSummary || (allowLocalFallback ? cachedSummary : null),
          loading: {
            isLoading: false,
            error: null,
          },
          summaryInitialized: true,
        });
      } catch (error) {
        if (operationEpoch !== sourceResumeStoreEpoch) {
          return;
        }

        const errorMessage = error instanceof Error ? error.message : '加载源简历摘要失败';
        set(state => ({
          latestSourceResumeSummary: allowLocalFallback && cachedSummary
            ? cachedSummary
            : state.latestSourceResumeSummary,
          loading: {
            ...state.loading,
            isLoading: false,
            error: allowLocalFallback && cachedSummary ? null : errorMessage,
          },
          summaryInitialized: true,
        }));
        console.error('[SourceResumeStore] Failed to load source summary:', error);
      }
    })().finally(() => {
      loadLatestSourceSummaryPromise = null;
    });

    return loadLatestSourceSummaryPromise;
  },

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
          // Landing pending resume is latest guest selection and takes priority
          // over an older generic cache.
          cachedResume = await readCachedSourceResume(storageKey, isGuest);
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
          latestSourceResumeSummary: cachedResume
            ? toSourceResumeSummaryMetaFromSummary(cachedResume)
            : null,
          loading: {
            isLoading: false,
            error: null,
          },
          initialized: true,
          summaryInitialized: true,
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
          latestSourceResumeSummary: latestResume
            ? toSourceResumeSummaryMetaFromSummary(latestResume)
            : null,
          loading: {
            isLoading: false,
            error: null,
          },
          initialized: true,
          summaryInitialized: true,
        });
      } catch (error) {
        if (operationEpoch !== sourceResumeStoreEpoch) {
          return;
        }

        const errorMessage =
          error instanceof Error ? error.message : '加载源简历失败';

        set(state => {
          const latestSourceResume = allowLocalFallback
            ? cachedResume ?? state.latestSourceResume
            : null;
          return {
            latestSourceResume,
            latestSourceResumeSummary: latestSourceResume
              ? toSourceResumeSummaryMetaFromSummary(latestSourceResume)
              : null,
            loading: {
              ...state.loading,
              isLoading: false,
              error: allowLocalFallback && cachedResume ? null : errorMessage,
            },
            initialized: true,
            summaryInitialized: true,
          };
        });

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
      latestSourceResumeSummary: resume
        ? toSourceResumeSummaryMetaFromSummary(resume)
        : null,
      loading: {
        isLoading: false,
        error: null,
      },
      initialized: true,
      summaryInitialized: true,
    });
  },

  deleteLatestSourceResume: async (id: string) => {
    const operationEpoch = sourceResumeStoreEpoch;
    const storageKey = getSourceResumeStorageKey();
    // Landing 未登录上传只产生本地 ID；服务端 ID 即使来自缓存也要尝试删除。
    if (!/^landing-source-\d+$/.test(id)) {
      try {
        await sourceResumeApi.deleteSourceResume(id);
      } catch (error) {
        if (!(error instanceof RequestError)
          || error.statusCode !== 404 || error.code !== 'SOURCE_RESUME_NOT_FOUND') {
          throw error;
        }
      }
    }
    if (operationEpoch !== sourceResumeStoreEpoch) {
      return;
    }
    // 使删除前启动的加载失效，避免旧响应把已删简历重新写回。
    const deletionEpoch = ++sourceResumeStoreEpoch;
    loadLatestSourceResumePromise = null;
    const keys = new Set([storageKey, SOURCE_RESUME_STORAGE_KEY, PENDING_LANDING_SOURCE_RESUME_KEY]);
    for (const key of keys) {
      const cached = await getJSON<SourceResumeSummary>(key);
      if (deletionEpoch !== sourceResumeStoreEpoch) return;
      if (cached?.id === id) await storage.removeItem(key);
    }
    if (deletionEpoch !== sourceResumeStoreEpoch) return;
    const currentResume = get().latestSourceResume;
    if (currentResume && currentResume.id !== id) {
      set({
        latestSourceResumeSummary: toSourceResumeSummaryMetaFromSummary(currentResume),
        summaryInitialized: true,
      });
      return;
    }
    set({
      latestSourceResume: null,
      latestSourceResumeSummary: null,
      loading: {
        isLoading: false,
        error: null,
      },
      initialized: true,
      summaryInitialized: true,
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
      latestSourceResumeSummary: null,
      loading: {
        isLoading: false,
        error: null,
      },
      initialized: true,
      summaryInitialized: true,
    });
  },

  reset: () => {
    sourceResumeStoreEpoch += 1;
    loadLatestSourceResumePromise = null;
    loadLatestSourceSummaryPromise = null;
    set(initialState);
  },
}));
