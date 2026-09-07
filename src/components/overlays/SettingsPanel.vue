<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NANOGPT_SIGNUP_URL } from '@/config'
import { formatUsd } from '@/lib/cost'
import { useLanguageStore } from '@/stores/language'
import { checkBalance, NanoGptError } from '@/services/nanogpt'
import { describeFailure } from '@/lib/failure'
import { failureWordsIn } from '@/i18n/bundles'
import { useSettingsStore } from '@/stores/settings'
import ModelPicker from '@/components/ModelPicker.vue'
import LinkedText from '@/components/ui/LinkedText.vue'
import { useTourStore } from '@/stores/tour'
import { useUiStore } from '@/stores/ui'
import { useI18n } from '@/i18n'

const settings = useSettingsStore()
const language = useLanguageStore()
const { t } = useI18n()
const tour = useTourStore()
const ui = useUiStore()

/** Settings is over the app; the tour needs the app itself, so this closes
 *  the overlay on its way out. */
function runTour(): void {
  ui.closeOverlay()
  void tour.start()
}
const showKey = ref(false)
const balance = ref<number | null>(null)
const balanceLoading = ref(false)
const balanceError = ref<string | null>(null)

async function refreshBalance(): Promise<void> {
  balanceLoading.value = true
  balanceError.value = null
  try {
    balance.value = (await checkBalance(settings.apiKey)).usdBalance
  } catch (error) {
    // Classified like every other model-side failure, so a rejected key reads
    // the same here as it does inside a book.
    const status = error instanceof NanoGptError ? error.status : null
    balanceError.value = describeFailure(
      status,
      navigator.onLine !== false,
      failureWordsIn(language.code),
    ).message
  } finally {
    balanceLoading.value = false
  }
}

const keyPresent = computed(() => settings.apiKey.trim().length > 0)

onMounted(() => {
  void settings.loadModels()
})
</script>

<template>
  <section class="settings-panel" data-testid="settings-panel">
    <h2 class="section-title">{{ t('settings.keyTitle') }}</h2>
    <!-- Two sentences with a link inside each. The link is placed by the
         translation's own {link} rather than by splicing English around it,
         which is how a sentence survives a language that puts it elsewhere. -->
    <p class="prose">
      <LinkedText :text="t('settings.keyIntro1')" :href="NANOGPT_SIGNUP_URL" label="NanoGPT" />
      <LinkedText
        :text="t('settings.keyIntro2')"
        :href="NANOGPT_SIGNUP_URL"
        :label="t('settings.createAccount')"
      />
    </p>
    <!-- The link above is a referral. Saying so beside it costs a line and is
         the difference between support and a quiet cut. -->
    <p class="referral">{{ t('settings.referral') }}</p>
    <div class="key-row">
      <input
        v-model="settings.apiKey"
        :type="showKey ? 'text' : 'password'"
        :placeholder="t('settings.keyPlaceholder')"
        autocomplete="off"
        :aria-label="t('settings.keyLabel')"
      />
      <button type="button" @click="showKey = !showKey">
        {{ showKey ? t('settings.hide') : t('settings.show') }}
      </button>
    </div>
    <p class="status" data-testid="key-status">
      {{ keyPresent ? t('settings.keySaved') : t('settings.noKey') }}
    </p>

    <div v-if="keyPresent" class="balance-row">
      <button type="button" :disabled="balanceLoading" @click="refreshBalance">
        {{ balanceLoading ? t('settings.checking') : t('settings.checkBalance') }}
      </button>
      <span v-if="balance !== null" class="balance" data-testid="balance">
        {{ t('settings.balance', { amount: formatUsd(balance, language.code) }) }}
      </span>
      <span v-if="balanceError" class="error-text" role="alert">{{ balanceError }}</span>
    </div>

    <hr class="gold-rule" />

    <h2 class="section-title">{{ t('settings.modelTitle') }}</h2>
    <div class="model-row" data-testid="global-model">
      <ModelPicker
        v-model="settings.modelId"
        size="large"
        :label="t('settings.modelTitle')"
        :models="settings.models"
        :favourite-ids="settings.favoriteModelIds"
        :loading="settings.modelsLoading"
        :failure="settings.modelsFailure"
        @reload="settings.loadModels(true)"
        @toggle-favourite="settings.toggleFavorite"
      />
    </div>
    <p class="hint">{{ t('settings.modelHint') }}</p>

    <hr class="gold-rule" />

    <h2 class="section-title">{{ t('tour.settingsTitle') }}</h2>
    <p class="hint">{{ t('tour.settingsHint') }}</p>
    <p class="tour-row">
      <button type="button" data-testid="run-tour" @click="runTour">
        {{ t('tour.settingsButton') }}
      </button>
    </p>
  </section>
</template>

<style scoped>
.settings-panel {
  min-width: 0;
}
.section-title {
  font-size: 1.15rem;
  margin: 0 0 0.5rem;
}
.referral {
  margin: -0.35rem 0 0.9rem;
  font-size: 0.76rem;
  line-height: 1.5;
  color: var(--text-faint);
}
.prose {
  margin: 0 0 0.9rem;
  color: var(--text-dim);
  font-size: 0.9rem;
}
.key-row {
  display: flex;
  gap: 0.5rem;
}
.key-row input {
  flex: 1;
  min-width: 0;
}
.status {
  color: var(--text-faint);
  font-size: 0.82rem;
}
.balance-row {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-top: 0.5rem;
  flex-wrap: wrap;
}
.balance {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--gold);
}
.model-row {
  max-width: 26rem;
}
.hint {
  color: var(--text-faint);
  font-size: 0.8rem;
}
.tour-row {
  margin: 0.6rem 0 0;
}
</style>
