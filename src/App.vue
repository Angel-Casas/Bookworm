<script setup lang="ts">
import { computed, onMounted, ref, watch, watchEffect } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { useUiStore } from '@/stores/ui'
import { useLanguageStore } from '@/stores/language'
import { directionOf } from '@/lib/language'
import { loadLocale } from '@/i18n'
import LanguageFirstRun from '@/components/overlays/LanguageFirstRun.vue'
import AppNav from '@/components/AppNav.vue'
import SettingsOverlay from '@/components/overlays/SettingsOverlay.vue'
import LangOverlay from '@/components/overlays/LangOverlay.vue'
import SupportOverlay from '@/components/overlays/SupportOverlay.vue'
import ShelfSearch from '@/components/overlays/ShelfSearch.vue'
import TourGuide from '@/components/tour/TourGuide.vue'
import UpdateNotice from '@/components/UpdateNotice.vue'
import { useTourStore } from '@/stores/tour'
import { useUpdateStore } from '@/stores/update'

const route = useRoute()
const router = useRouter()
const ui = useUiStore()
const language = useLanguageStore()
const tour = useTourStore()
const update = useUpdateStore()

/**
 * The language question comes before anything else, on whatever page the reader
 * happened to arrive at — a link straight to a book is still a first visit.
 */
/**
 * The document's own language and direction. Everything else — text alignment,
 * where a caret sits in an input, which way a list indents, and every logical
 * CSS property in the app — follows from these two attributes, so they are set
 * in one place and nothing downstream has to ask again.
 */
watchEffect(() => {
  const root = document.documentElement
  root.setAttribute('lang', language.code)
  root.setAttribute('dir', directionOf(language.code))
  // English is bundled; the rest arrive as their own chunk. Nothing waits on
  // it — the app renders in English and re-renders when the words land, which
  // is a blink on a local chunk and correct even if the chunk never comes.
  void loadLocale(language.code)
})

const askingLanguage = ref(false)
/** Where they landed, remembered before they answer: the landing page says its
 *  own piece about the app, so only a reader who skipped it is owed the note
 *  pointing at the globe in the bar. */
const arrivedOnLanding = ref(false)

onMounted(async () => {
  // The first navigation has not necessarily resolved when the app mounts, and
  // both of the questions below depend on knowing which page the reader
  // actually landed on.
  await router.isReady()
  // Start listening for a newer build. Nothing is shown unless one arrives,
  // and nothing is applied until the reader says so.
  void update.watch()
  arrivedOnLanding.value = route.name === 'landing'
  askingLanguage.value = !language.chosen
  // One question at a time: the tour waits until the language has been
  // settled, and never interrupts the landing film.
  if (!askingLanguage.value) offerTour()
})

/**
 * The tour runs itself once, on a first visit, and only where there is
 * something to tour — the landing page is its own introduction, and a reader
 * who arrived at a book came for the book.
 */
function offerTour(): void {
  if (tour.seen || tour.active || route.name !== 'library') return
  void tour.start()
}

/**
 * ARRIVING at the shelf is what offers the tour, not booting up on it.
 *
 * A first visit usually starts on the landing page and walks into the library
 * a moment later, which the old one-shot check at mount missed entirely: the
 * tour only appeared if you reloaded once you were there. The guards above
 * make this safe to fire on every navigation — it has been seen, or it is
 * already running (the tour itself walks to a book and back), or this is not
 * the shelf.
 */
watch(
  () => route.name,
  () => {
    if (!askingLanguage.value) offerTour()
  },
)

function onLanguageChosen(): void {
  askingLanguage.value = false
  offerTour()
  // Only a reader who skipped the landing page needs telling where the
  // language control is; the landing page introduces the app itself.
  if (!arrivedOnLanding.value) language.offerHint()
}

// The landing page is a full-bleed film; it brings its own navigation.
const showChrome = computed(() => route.name !== 'landing')
</script>

<template>
  <AppNav v-if="showChrome && ui.chromeVisible" />
  <main>
    <!-- One view leaves before the next arrives, so the two never overlap in
         the layout. The reader keys on the book, so opening a different book
         is a new arrival rather than a silent swap of contents. -->
    <RouterView v-slot="{ Component, route: current }">
      <Transition name="view-fade" mode="out-in">
        <component :is="Component" :key="current.fullPath" />
      </Transition>
    </RouterView>
  </main>
  <Transition name="veil-fade">
    <LanguageFirstRun v-if="askingLanguage" @done="onLanguageChosen" />
  </Transition>
  <Transition name="veil-fade">
    <SettingsOverlay v-if="showChrome && ui.overlay === 'settings'" @close="ui.closeOverlay()" />
  </Transition>
  <Transition name="veil-fade">
    <LangOverlay v-if="showChrome && ui.overlay === 'lang'" @close="ui.closeOverlay()" />
  </Transition>
  <Transition name="veil-fade">
    <SupportOverlay v-if="showChrome && ui.overlay === 'support'" @close="ui.closeOverlay()" />
  </Transition>
  <Transition name="veil-fade">
    <ShelfSearch v-if="showChrome && ui.overlay === 'shelf'" @close="ui.closeOverlay()" />
  </Transition>
  <UpdateNotice />
  <TourGuide />
</template>
