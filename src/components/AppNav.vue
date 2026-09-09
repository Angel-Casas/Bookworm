<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useUiStore } from '@/stores/ui'
import { useLanguageStore } from '@/stores/language'
import { useI18n } from '@/i18n'
import IconMedallion from '@/components/icons/IconMedallion.vue'
import IconSettings from '@/components/icons/IconSettings.vue'
import IconTheme from '@/components/icons/IconTheme.vue'
import IconLang from '@/components/icons/IconLang.vue'
import IconSupport from '@/components/icons/IconSupport.vue'
import IconClose from '@/components/icons/IconClose.vue'
import InstallHint from '@/components/InstallHint.vue'

const ui = useUiStore()
const language = useLanguageStore()
const { t } = useI18n()

/** The note is a one-time courtesy, so ANY use of the globe retires it — a
 *  reader who has opened the menu has been told by doing. */
function openLanguage(): void {
  language.dismissHint()
  ui.toggleOverlay('lang')
}

const settingsOpen = computed(() => ui.overlay === 'settings')
const langOpen = computed(() => ui.overlay === 'lang')
const supportOpen = computed(() => ui.overlay === 'support')
</script>

<template>
  <header class="app-nav">
    <RouterLink to="/library" class="brand" :aria-label="t('nav.library')">
      <IconMedallion class="brand-mark" />
      <span class="brand-name">Bookworm</span>
    </RouterLink>

    <!-- Hangs from the bar, centred. It is here rather than in the page so it
         can be measured against the bar's own height. -->
    <InstallHint />

    <nav class="nav-actions" :aria-label="t('nav.actions')">
      <button
        type="button"
        class="nav-btn"
        data-testid="nav-support"
        :aria-label="supportOpen ? t('nav.supportClose') : t('nav.support')"
        :aria-expanded="supportOpen"
        @click="ui.toggleOverlay('support')"
      >
        <span class="morph-stack" aria-hidden="true">
          <IconSupport class="nav-icon" :class="{ off: supportOpen }" />
          <IconClose class="nav-icon" :class="{ off: !supportOpen }" />
        </span>
      </button>
      <div class="lang-wrap">
        <button
          type="button"
          class="nav-btn"
          data-testid="nav-lang"
          :aria-label="langOpen ? t('nav.languageClose') : t('nav.language')"
          :aria-expanded="langOpen"
          @click="openLanguage"
        >
          <span class="morph-stack" aria-hidden="true">
            <IconLang class="nav-icon" :class="{ off: langOpen }" />
            <IconClose class="nav-icon" :class="{ off: !langOpen }" />
          </span>
        </button>
        <!-- Said once, under the thing it is about, to a reader who came
             straight to their shelf and never saw the landing page. -->
        <Transition name="panel-rise">
          <div
            v-if="language.hintVisible && !langOpen"
            class="lang-hint"
            role="status"
            data-testid="lang-hint"
          >
            <i class="hint-nib" aria-hidden="true"></i>
            <p>{{ t('nav.langHint') }}</p>
            <button
              type="button"
              class="hint-x"
              data-testid="lang-hint-dismiss"
              :aria-label="t('nav.dismiss')"
              @click="language.dismissHint()"
            >
              <IconClose class="hint-x-icon" aria-hidden="true" />
            </button>
          </div>
        </Transition>
      </div>
      <button
        type="button"
        class="nav-btn"
        data-testid="nav-theme"
        :aria-label="ui.theme === 'dark' ? t('nav.toLight') : t('nav.toDark')"
        @click="ui.toggleTheme()"
      >
        <span class="morph-stack" aria-hidden="true">
          <IconTheme mode="dark" class="nav-icon" :class="{ off: ui.theme !== 'dark' }" />
          <IconTheme mode="light" class="nav-icon" :class="{ off: ui.theme !== 'light' }" />
        </span>
      </button>
      <button
        type="button"
        class="nav-btn"
        data-testid="nav-settings"
        :aria-label="settingsOpen ? t('nav.settingsClose') : t('nav.settings')"
        :aria-expanded="settingsOpen"
        @click="ui.toggleOverlay('settings')"
      >
        <span class="morph-stack" aria-hidden="true">
          <IconSettings class="nav-icon" :class="{ off: settingsOpen }" />
          <IconClose class="nav-icon" :class="{ off: !settingsOpen }" />
        </span>
      </button>
    </nav>
  </header>
</template>

<style scoped>
.app-nav {
  /* One place for the geometry the note and its nib are measured against. */
  --nav-btn-size: 2.25rem;
  --hint-inset: 0.4rem;
  --hint-nib-size: 7px;
  /* The note's own border: `right` on the nib is measured from the note's
     PADDING edge, which sits one border inside its box. */
  --hint-border: 1px;
}
.lang-wrap {
  position: relative;
  display: flex;
}
/* Hangs from the globe, pointing at it. Narrow enough to stay on a phone, and
   pinned to the RIGHT so it can never run off that edge. */
/* The note hangs a little past the globe's right edge so it does not crowd the
   window's own edge; the nib below is measured back from that same inset, so
   the two cannot drift apart. */
.lang-hint {
  position: absolute;
  top: calc(100% + 0.55rem);
  inset-inline-end: calc(-1 * var(--hint-inset));
  z-index: 40;
  width: max-content;
  max-width: min(16rem, calc(100vw - 2rem));
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  padding: 0.6rem 0.5rem 0.6rem 0.7rem;
  background: var(--bg-panel);
  border: var(--hint-border) solid var(--gold-deep);
  border-radius: 3px;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45);
}
.lang-hint p {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 0.82rem;
  line-height: 1.35;
  color: var(--text);
}
/* Centred on the GLOBE, not eyeballed: the note's right edge is one inset past
   the button's right edge, so the button's middle is that inset plus half a
   button back — less half the nib, because `right` places its edge and the
   rotation turns it about its own centre. */
.hint-nib {
  position: absolute;
  top: -4px;
  inset-inline-end: calc(
    var(--hint-inset) + var(--nav-btn-size) / 2 - var(--hint-nib-size) / 2 - var(--hint-border)
  );
  width: var(--hint-nib-size);
  height: var(--hint-nib-size);
  background: var(--bg-panel);
  border-left: var(--hint-border) solid var(--gold-deep);
  border-top: var(--hint-border) solid var(--gold-deep);
  transform: rotate(45deg);
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
  color: var(--gold);
}
.hint-x-icon {
  width: 11px;
  height: 11px;
}
.app-nav {
  /* Above the overlays (z 60), so the morphing X in the nav stays clickable. */
  position: sticky;
  top: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.55rem clamp(0.9rem, 3vw, 2rem);
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--hair-soft);
  transition:
    background 0.35s ease,
    border-color 0.35s ease;
}
.brand {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  text-decoration: none;
}
.brand-mark {
  width: 30px;
  height: 30px;
  color: var(--gold);
  transition: transform 0.5s var(--ease-wipe);
}
.brand:hover .brand-mark {
  transform: rotate(90deg);
}
.brand-name {
  font-family: var(--font-display);
  font-weight: 500;
  font-size: 1.02rem;
  letter-spacing: 0.3em;
  text-indent: 0.05em;
  text-transform: uppercase;
  color: var(--text);
}
.nav-actions {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}
.nav-btn {
  display: grid;
  place-items: center;
  width: var(--nav-btn-size);
  height: var(--nav-btn-size);
  padding: 0;
  border: 1px solid transparent;
  border-radius: 50%;
  color: var(--text-dim);
}
.nav-btn:hover:not(:disabled) {
  color: var(--gold);
  border-color: var(--hair-soft);
}
.nav-btn[aria-expanded='true'] {
  color: var(--gold);
  border-color: var(--hair);
}
.morph-stack {
  position: relative;
  width: 20px;
  height: 20px;
  display: block;
}
.nav-icon {
  position: absolute;
  inset: 0;
  width: 20px;
  height: 20px;
  display: block;
  transition:
    opacity 0.2s ease,
    transform 0.24s var(--ease-wipe);
}
.nav-icon.off {
  opacity: 0;
  transform: rotate(-70deg) scale(0.7);
  pointer-events: none;
}
@media (max-width: 560px) {
  .brand-name {
    font-size: 0.88rem;
    letter-spacing: 0.22em;
  }
}
</style>
