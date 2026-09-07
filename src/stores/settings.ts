/** User settings persisted to localStorage (API key never leaves the device). */
import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { describeFailure, type Failure } from '@/lib/failure'
import { failureWordsIn } from '@/i18n/bundles'
import { translateIn } from '@/i18n'
import { useLanguageStore } from '@/stores/language'
import { listModels, NanoGptError, type NanoModel } from '@/services/nanogpt'

const STORAGE_KEY = 'bookworm.settings.v1'

interface PersistedSettings {
  apiKey: string
  modelId: string
  favoriteModelIds: string[]
}

function readPersisted(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedSettings>
      return {
        apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
        modelId: typeof parsed.modelId === 'string' ? parsed.modelId : '',
        favoriteModelIds: Array.isArray(parsed.favoriteModelIds)
          ? parsed.favoriteModelIds.filter((id): id is string => typeof id === 'string')
          : [],
      }
    }
  } catch {
    // Corrupt or unavailable storage: fall through to defaults.
  }
  return { apiKey: '', modelId: '', favoriteModelIds: [] }
}

export const useSettingsStore = defineStore('settings', () => {
  const persisted = readPersisted()
  const apiKey = ref(persisted.apiKey)
  const modelId = ref(persisted.modelId)
  const favoriteModelIds = ref<string[]>(persisted.favoriteModelIds)
  const models = ref<NanoModel[]>([])
  const modelsLoading = ref(false)
  /** Why the model list would not load, classified — and always offered as a
   *  retry: the key field is on the same page as the list, so "open settings"
   *  would be pointing at itself. */
  const modelsFailure = ref<Failure | null>(null)

  watch(
    [apiKey, modelId, favoriteModelIds],
    () => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            apiKey: apiKey.value,
            modelId: modelId.value,
            favoriteModelIds: [...favoriteModelIds.value],
          }),
        )
      } catch {
        // Storage full/unavailable: settings simply won't persist.
      }
    },
    { deep: true },
  )

  async function loadModels(force = false): Promise<void> {
    if (modelsLoading.value || (models.value.length > 0 && !force)) return
    modelsLoading.value = true
    modelsFailure.value = null
    try {
      models.value = await listModels()
    } catch (error) {
      const status = error instanceof NanoGptError ? error.status : null
      const code = useLanguageStore().code
      const described = describeFailure(status, navigator.onLine !== false, failureWordsIn(code))
      modelsFailure.value = {
        ...described,
        action: 'retry',
        actionLabel: translateIn(code, 'failure.offline.action'),
      }
    } finally {
      modelsLoading.value = false
    }
  }

  function selectedModel(): NanoModel | null {
    return models.value.find((model) => model.id === modelId.value) ?? null
  }

  function modelById(id: string): NanoModel | null {
    return models.value.find((model) => model.id === id) ?? null
  }

  function isFavorite(id: string): boolean {
    return favoriteModelIds.value.includes(id)
  }

  function toggleFavorite(id: string): void {
    favoriteModelIds.value = isFavorite(id)
      ? favoriteModelIds.value.filter((candidate) => candidate !== id)
      : [...favoriteModelIds.value, id]
  }

  return {
    apiKey,
    modelId,
    favoriteModelIds,
    models,
    modelsLoading,
    modelsFailure,
    loadModels,
    selectedModel,
    modelById,
    isFavorite,
    toggleFavorite,
  }
})
