<script setup lang="ts">
/**
 * The first thing a new reader sees, whatever page they arrived on.
 *
 * It asks one question and gets out of the way. Choosing a language IS the
 * answer — the tap that picks it is the tap that closes the door, because a
 * highlighted row and a separate "confirm" button read as a control that does
 * nothing. Escape takes the highlighted one (the browser's own preference):
 * a question nobody can decline is a trap, and one that returns every visit
 * is worse.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { LANGUAGES } from '@/lib/language'
import { useLanguageStore } from '@/stores/language'
import OrnateFrame from '@/components/ui/OrnateFrame.vue'
import IconMedallion from '@/components/icons/IconMedallion.vue'
import { useI18n } from '@/i18n'

const emit = defineEmits<{ done: [] }>()

const language = useLanguageStore()
const { t } = useI18n()
/** The browser's guess, highlighted until the reader answers. */
const picked = ref(language.code)

function choose(code: string): void {
  picked.value = code
  language.choose(code)
  emit('done')
}

function onKey(event: KeyboardEvent): void {
  // Declining is answering with the guess — never with silence, which would
  // bring this back on every visit.
  if (event.key === 'Escape') choose(picked.value)
}

/** The chosen row, so focus lands INSIDE the dialog rather than behind it.
 *  On the element itself — a ref on a component hands back the component, and
 *  asking that for a querySelector throws (which is exactly what it did). */
const chosenRef = ref<HTMLButtonElement | null>(null)
onMounted(() => {
  window.addEventListener('keydown', onKey)
  chosenRef.value?.focus()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div
    class="first-run"
    role="dialog"
    aria-modal="true"
    aria-labelledby="first-run-title"
    data-testid="language-first-run"
  >
    <!-- No dismissing scrim: this is the one question the app asks, and a stray
         tap on the way to the page should not answer it by accident. -->
    <div class="overlay-scrim"></div>
    <OrnateFrame class="overlay-panel">
      <header class="head">
        <IconMedallion class="mark" aria-hidden="true" />
        <h1 id="first-run-title" class="title">{{ t('overlay.language') }}</h1>
        <p class="lede">{{ t('firstRun.lede') }}</p>
      </header>

      <ul class="lang-list">
        <li v-for="entry in LANGUAGES" :key="entry.code">
          <button
            :ref="
              (el) => {
                if (picked === entry.code) chosenRef = el as HTMLButtonElement
              }
            "
            type="button"
            class="lang"
            :class="{ on: picked === entry.code }"
            :aria-pressed="picked === entry.code"
            :lang="entry.code"
            :data-testid="`first-run-${entry.code}`"
            @click="choose(entry.code)"
          >
            <span class="code">{{ entry.code }}</span>
            <span class="name">{{ entry.name }}</span>
          </button>
        </li>
      </ul>

      <p class="state" data-testid="first-run-state">{{ t('firstRun.state') }}</p>
      <p class="after">{{ t('firstRun.after') }}</p>
    </OrnateFrame>
  </div>
</template>

<style scoped>
.first-run {
  position: fixed;
  inset: 0;
  /* Above every other overlay: nothing is behind this to be reached. */
  z-index: 200;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: clamp(1.5rem, 7vh, 5rem) 1rem 2rem;
  overflow-y: auto;
}
.overlay-scrim {
  position: fixed;
  inset: 0;
  background: var(--scrim);
  backdrop-filter: blur(3px);
}
.overlay-panel {
  position: relative;
  width: min(32rem, 100%);
  padding: 1.7rem 1.6rem 1.5rem;
}
.head {
  text-align: center;
  margin-bottom: 1.1rem;
}
.mark {
  width: 2.4rem;
  height: 2.4rem;
  color: var(--gold-deep);
}
.title {
  margin: 0.4rem 0 0;
  font-family: var(--font-display);
  font-weight: 500;
  font-size: 1.25rem;
  letter-spacing: 0.26em;
  text-transform: uppercase;
}
.lede {
  margin: 0.5rem 0 0;
  font-family: var(--font-serif);
  font-size: 0.95rem;
  color: var(--text-dim);
}
.lang-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
  gap: 0.4rem;
}
.lang {
  width: 100%;
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  text-transform: none;
  letter-spacing: 0;
  padding: 0.55em 0.8em;
}
.lang .code {
  font-family: var(--font-mono);
  font-size: 0.58rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.lang .name {
  font-family: var(--font-serif);
  font-size: 0.98rem;
  color: var(--text);
}
.lang.on {
  border-color: var(--gold-deep);
  box-shadow: inset 2px 0 0 var(--gold);
}
.lang.on .code {
  color: var(--gold);
}
.after {
  margin: 1rem 0 0;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 0.56rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-faint);
}
</style>
