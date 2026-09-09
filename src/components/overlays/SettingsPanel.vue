<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NANOGPT_API_KEYS_URL, NANOGPT_SIGNUP_URL } from '@/config'
import { formatUsd } from '@/lib/cost'
import { useLanguageStore } from '@/stores/language'
import { useBalanceStore } from '@/stores/balance'
import { useInstallStore } from '@/stores/install'
import { useSettingsStore } from '@/stores/settings'
import ModelPicker from '@/components/ModelPicker.vue'
import LinkedText from '@/components/ui/LinkedText.vue'
import { useTourStore } from '@/stores/tour'
import { useUiStore } from '@/stores/ui'
import { useI18n } from '@/i18n'

const settings = useSettingsStore()
const language = useLanguageStore()
/** The same balance the shelf shows — asked for once, in one place. */
const balance = useBalanceStore()
/** The note under the nav is said once; this is where it lives afterwards. */
const install = useInstallStore()
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

const keyPresent = computed(() => settings.apiKey.trim().length > 0)

/** A new key is a new account: whatever figure is held belongs to the old one. */
watch(
  () => settings.apiKey,
  () => balance.forget(),
)

onMounted(() => {
  void settings.loadModels()
})
</script>

<template>
  <section class="settings-panel" data-testid="settings-panel">
    <h2 class="section-title">{{ t('settings.keyTitle') }}</h2>
    <!-- One sentence with a link inside it. The link is placed by the
         translation's own {link} rather than by splicing English around it,
         which is how a sentence survives a language that puts it elsewhere. -->
    <p class="prose">
      <LinkedText :text="t('settings.keyIntro1')" :href="NANOGPT_SIGNUP_URL" label="NanoGPT" />
    </p>
    <!-- Three steps, numbered, in the order they have to happen. A reader
         with no key is not short of an explanation of what a key IS — they are
         short of knowing that there are exactly three things to do and that
         none of them takes long. The tour's quick walk ends pointing here. -->
    <ol class="setup" data-testid="key-setup">
      <li>
        <span class="step-no" aria-hidden="true">1</span>
        <span class="step-body">
          <strong class="step-title">{{ t('settings.setup1Title') }}</strong>
          <LinkedText
            :text="t('settings.setup1')"
            :href="NANOGPT_SIGNUP_URL"
            label="nano-gpt.com"
          />
        </span>
      </li>
      <li>
        <span class="step-no" aria-hidden="true">2</span>
        <span class="step-body">
          <strong class="step-title">{{ t('settings.setup2Title') }}</strong>
          {{ t('settings.setup2') }}
        </span>
      </li>
      <li>
        <span class="step-no" aria-hidden="true">3</span>
        <span class="step-body">
          <strong class="step-title">{{ t('settings.setup3Title') }}</strong>
          <LinkedText
            :text="t('settings.setup3')"
            :href="NANOGPT_API_KEYS_URL"
            label="nano-gpt.com/api"
          />
        </span>
      </li>
    </ol>
    <!-- The link above is an invitation. Saying so beside it — along with what
         it is worth to the reader — costs a line and is the difference between
         support and a quiet cut. -->
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
      <button type="button" :disabled="balance.loading" @click="balance.refresh(true)">
        {{ balance.loading ? t('settings.checking') : t('settings.checkBalance') }}
      </button>
      <span v-if="balance.usd !== null" class="balance" data-testid="balance">
        {{ t('settings.balance', { amount: formatUsd(balance.usd, language.code) }) }}
      </span>
      <span v-if="balance.failure" class="error-text" role="alert">{{
        balance.failure.message
      }}</span>
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

    <!-- The one-time note under the nav is gone by now, and a browser hides
         its own install control somewhere different every year. So the offer
         has a permanent home: the button when the browser has handed us one,
         and directions when it has not — which is every iPhone, where the
         only way in is the Share menu. -->
    <h2 class="section-title">{{ t('install.title') }}</h2>
    <p class="hint">{{ t('install.settingsHint') }}</p>
    <p v-if="install.installed" class="status" data-testid="install-status">
      {{ t('install.already') }}
    </p>
    <p v-else-if="install.offerable" class="tour-row">
      <button
        type="button"
        :disabled="install.asking"
        data-testid="install-now"
        @click="install.install()"
      >
        {{ t('install.action') }}
      </button>
    </p>
    <p v-else class="hint" data-testid="install-manual">{{ t('install.manual') }}</p>

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
/* Numbered in the markup rather than by the list's own counter: the number
   is a mark in gold beside the step, not a prefix to its first line. */
.setup {
  list-style: none;
  margin: 0 0 0.9rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
.setup li {
  display: grid;
  grid-template-columns: 1.4rem 1fr;
  gap: 0.55rem;
  align-items: baseline;
}
.step-no {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--gold);
  text-align: end;
}
.step-body {
  color: var(--text-dim);
  font-size: 0.86rem;
  line-height: 1.5;
}
.step-title {
  display: block;
  font-weight: 500;
  color: var(--text);
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
