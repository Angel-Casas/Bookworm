<script setup lang="ts">
/**
 * "This can live on your device" — said once, under the nav.
 *
 * A plate rather than a banner, and under the bar rather than over the page:
 * it is an offer, not news, and a reader who came here to read owes it no
 * attention at all. It carries the install itself, because the browser handed
 * us the dialogue and pointing at the address bar instead would be sending
 * someone to look for a control we are already holding.
 */
import IconClose from '@/components/icons/IconClose.vue'
import { useInstallStore } from '@/stores/install'
import { useI18n } from '@/i18n'

const install = useInstallStore()
const { t } = useI18n()
</script>

<template>
  <Transition name="panel-rise">
    <div v-if="install.hintVisible" class="install-hint" role="status" data-testid="install-hint">
      <i class="hint-nib" aria-hidden="true"></i>
      <p class="words">{{ install.byHand ? t('install.hintByHand') : t('install.hint') }}</p>
      <!-- No button where there is no dialogue to open: on an iPhone the line
           above is the whole of what we can offer. -->
      <button
        v-if="!install.byHand"
        type="button"
        class="take"
        :disabled="install.asking"
        data-testid="install-take"
        @click="install.install()"
      >
        {{ t('install.action') }}
      </button>
      <button
        type="button"
        class="hint-x"
        data-testid="install-dismiss"
        :aria-label="t('install.dismiss')"
        :title="t('install.dismiss')"
        @click="install.dismissHint()"
      >
        <IconClose class="hint-x-icon" aria-hidden="true" />
      </button>
    </div>
  </Transition>
</template>

<style scoped>
/* Hangs from the bar, centred, and no wider than it has to be. Absolute
   against the nav itself, so it follows the bar's own height rather than a
   number copied out of it. */
.install-hint {
  position: absolute;
  top: calc(100% + 0.55rem);
  left: 50%;
  transform: translateX(-50%);
  z-index: 40;
  width: max-content;
  max-width: min(26rem, calc(100vw - 1.5rem));
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0.5rem 0.5rem 0.75rem;
  background: var(--bg-panel);
  border: 1px solid var(--gold-deep);
  border-radius: 3px;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45);
}
.hint-nib {
  position: absolute;
  top: -4px;
  left: 50%;
  width: 7px;
  height: 7px;
  margin-inline-start: -3.5px;
  background: var(--bg-panel);
  border-left: 1px solid var(--gold-deep);
  border-top: 1px solid var(--gold-deep);
  transform: rotate(45deg);
}
.words {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 0.82rem;
  line-height: 1.35;
  color: var(--text);
}
.take {
  flex: none;
  padding: 0.25rem 0.6rem;
  font-family: var(--font-mono);
  font-size: 0.58rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  border-color: var(--gold-deep);
  color: var(--gold);
}
.hint-x {
  flex: none;
  display: grid;
  place-items: center;
  width: 1.2rem;
  height: 1.2rem;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-faint);
}
.hint-x:hover {
  border: 0;
  color: var(--gold);
}
.hint-x-icon {
  width: 11px;
  height: 11px;
}
/* On a phone the line and its buttons will not sit on one row: the words take
   the top, the controls the bottom, and the plate stays inside the screen. */
@media (max-width: 30rem) {
  .install-hint {
    flex-wrap: wrap;
    max-width: calc(100vw - 1.5rem);
  }
  .words {
    flex: 1 1 100%;
  }
  .take {
    margin-inline-start: auto;
  }
}
</style>
