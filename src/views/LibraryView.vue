<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { formatUsd } from '@/lib/cost'
import { useLanguageStore } from '@/stores/language'
import { LIBRARY_SORT_OPTIONS, type LibrarySort } from '@/lib/librarySort'
import { shiftIntoView } from '@/lib/popover'
import { exportLibrary, importLibrary } from '@/services/backup'
import { useBalanceStore } from '@/stores/balance'
import { useLibraryStore } from '@/stores/library'
import { useSettingsStore } from '@/stores/settings'
import { useSpendStore } from '@/stores/spend'
import { useStatsStore } from '@/stores/stats'
import BookCard from '@/components/BookCard.vue'
import ReadingStrip from '@/components/ReadingStrip.vue'
import IconGrid from '@/components/icons/IconGrid.vue'
import IconRank from '@/components/icons/IconRank.vue'
import IconPlus from '@/components/icons/IconPlus.vue'
import IconArchive from '@/components/icons/IconArchive.vue'
import IconSearch from '@/components/icons/IconSearch.vue'
import { useI18n } from '@/i18n'
import { useUiStore } from '@/stores/ui'

const library = useLibraryStore()
const language = useLanguageStore()
const ui = useUiStore()
const { t } = useI18n()
const spend = useSpendStore()
const stats = useStatsStore()
const settings = useSettingsStore()
const balance = useBalanceStore()

/** Spent is what the books have cost; balance is what is left to spend with.
 *  The second only exists once there is a key to ask with. */
const hasKey = computed(() => settings.apiKey.trim().length > 0)
const fileInput = ref<HTMLInputElement | null>(null)
const backupInput = ref<HTMLInputElement | null>(null)
const backupBusy = ref(false)
const backupError = ref<string | null>(null)

const sortOpen = ref(false)
const sortWrap = ref<HTMLDivElement | null>(null)
const sortMenu = ref<HTMLDivElement | null>(null)
/**
 * How far the menu has to slide to stay on screen. It hangs from its BUTTON —
 * a menu that appears somewhere else on the page is a menu you have to hunt
 * for — and only moves as far as the edge forces it to.
 */
const sortShift = ref(0)

function toggleSort(): void {
  sortOpen.value = !sortOpen.value
  if (!sortOpen.value) return
  // Measured after it renders, with the old shift cleared, so what comes back
  // is where it would land on its own.
  sortShift.value = 0
  void nextTick(() => {
    const box = sortMenu.value?.getBoundingClientRect()
    if (box) sortShift.value = shiftIntoView(box, window.innerWidth)
  })
}

function pickSort(value: LibrarySort): void {
  library.setSort(value)
  sortOpen.value = false
}

function onDocumentClick(event: MouseEvent): void {
  if (sortOpen.value && !sortWrap.value?.contains(event.target as Node)) sortOpen.value = false
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') sortOpen.value = false
}

onMounted(() => {
  if (!library.loaded) void library.load()
  void spend.load()
  void stats.load()
  // Cached for a minute in the store, so walking in and out of a book does not
  // ask NanoGPT the same question five times.
  void balance.refresh()
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onDocumentKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onDocumentKeydown)
})

function openFilePicker(): void {
  fileInput.value?.click()
}

async function onFilesSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  if (input.files && input.files.length > 0) {
    await library.importFiles(Array.from(input.files))
  }
  input.value = ''
}

async function onRemove(id: string): Promise<void> {
  await library.removeBook(id)
}

async function onExport(): Promise<void> {
  backupBusy.value = true
  backupError.value = null
  try {
    const blob = await exportLibrary()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `bookworm-backup-${new Date().toISOString().slice(0, 10)}.zip`
    anchor.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    backupError.value = error instanceof Error ? error.message : t('library.exportFailed')
  } finally {
    backupBusy.value = false
  }
}

async function onImportBackup(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  backupBusy.value = true
  backupError.value = null
  try {
    await importLibrary(file)
    // Stores cache per-book state; a reload is the honest way to refresh everything.
    window.location.reload()
  } catch (error) {
    backupError.value = error instanceof Error ? error.message : t('library.importFailed')
    backupBusy.value = false
  }
}
</script>

<template>
  <section class="library">
    <header class="library-header">
      <div class="heading">
        <h1 class="page-title">{{ t('library.title') }}</h1>
        <!-- Two halves of the same sentence: what the reading has cost, and
             what is left to read with. The balance is a button because the
             only thing anyone wants from a number like that is a fresher
             one. -->
        <div class="ledger">
          <p class="spend" data-testid="library-spend">
            {{ t('library.totalSpent', { amount: formatUsd(spend.totalUsd, language.code) })
            }}<span v-if="spend.hasUnpriced">+</span>
          </p>
          <template v-if="hasKey">
            <span class="ledger-dot" aria-hidden="true">·</span>
            <button
              type="button"
              class="balance"
              data-testid="library-balance"
              :disabled="balance.loading"
              :title="balance.failure ? balance.failure.message : t('library.balanceRefresh')"
              @click="balance.refresh(true)"
            >
              <template v-if="balance.usd !== null">{{
                t('library.balance', { amount: formatUsd(balance.usd, language.code) })
              }}</template>
              <template v-else-if="balance.loading">{{ t('library.balanceLoading') }}</template>
              <template v-else>{{ t('library.balanceUnknown') }}</template>
            </button>
          </template>
        </div>
      </div>
      <div class="header-actions">
        <!-- Adding books comes first and comes biggest: on an empty shelf it is
             the only thing to do, and on a full one it is still the thing
             reached for most. The rest are icons of one size beside it, and
             the row centres them against it. -->
        <button
          type="button"
          class="icon-btn add-btn"
          data-testid="add-books"
          :disabled="library.importing"
          :aria-label="library.importing ? t('library.adding') : t('library.add')"
          :title="library.importing ? t('library.addingShort') : t('library.add')"
          @click="openFilePicker"
        >
          <IconPlus class="add-icon" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="icon-btn"
          data-testid="view-toggle"
          :aria-label="library.view === 'big' ? t('library.viewCompact') : t('library.viewBig')"
          :title="
            library.view === 'big' ? t('library.viewCompactShort') : t('library.viewBigShort')
          "
          @click="library.toggleView()"
        >
          <span class="morph-stack" aria-hidden="true">
            <IconGrid :cells="2" class="ctl-icon" :class="{ off: library.view !== 'big' }" />
            <IconGrid :cells="3" class="ctl-icon" :class="{ off: library.view !== 'compact' }" />
          </span>
        </button>
        <!-- One question the shelf could not answer until now: "which book
             was that sentence in?" -->
        <button
          type="button"
          class="icon-btn"
          data-testid="shelf-search"
          :aria-label="t('library.search')"
          :title="t('library.searchShort')"
          @click="ui.toggleOverlay('shelf')"
        >
          <IconSearch class="ctl-icon-fixed" aria-hidden="true" />
        </button>
        <div ref="sortWrap" class="sort-wrap">
          <button
            type="button"
            class="icon-btn"
            data-testid="sort-button"
            aria-haspopup="menu"
            :aria-expanded="sortOpen"
            :aria-label="t('library.sort')"
            :title="t('library.sort')"
            @click="toggleSort"
          >
            <IconRank class="ctl-icon-fixed" aria-hidden="true" />
          </button>
          <Transition name="pop-fade">
            <div
              v-if="sortOpen"
              ref="sortMenu"
              class="sort-menu"
              role="menu"
              :aria-label="t('library.sortBy')"
              :style="{ transform: `translateX(${sortShift}px)` }"
            >
              <button
                v-for="option in LIBRARY_SORT_OPTIONS"
                :key="option.id"
                type="button"
                role="menuitemradio"
                class="sort-option"
                :aria-checked="library.sort === option.id"
                :data-testid="`sort-option-${option.id}`"
                @click="pickSort(option.id)"
              >
                <span class="sort-tick" aria-hidden="true">{{
                  library.sort === option.id ? '◆' : ''
                }}</span>
                {{ t(option.labelKey) }}
              </button>
            </div>
          </Transition>
        </div>
        <button
          type="button"
          class="icon-btn"
          :disabled="backupBusy"
          data-testid="export-library"
          :aria-label="t('library.export')"
          :title="t('library.export')"
          @click="onExport"
        >
          <IconArchive dir="out" class="ctl-icon-fixed" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="icon-btn"
          :disabled="backupBusy"
          data-testid="import-backup"
          :aria-label="t('library.import')"
          :title="t('library.import')"
          @click="backupInput?.click()"
        >
          <IconArchive dir="in" class="ctl-icon-fixed" aria-hidden="true" />
        </button>
        <input
          ref="backupInput"
          type="file"
          accept=".zip,application/zip"
          hidden
          data-testid="backup-file-input"
          @change="onImportBackup"
        />
      </div>
      <input
        ref="fileInput"
        type="file"
        accept=".pdf,.epub,application/pdf,application/epub+zip"
        multiple
        hidden
        data-testid="book-file-input"
        @change="onFilesSelected"
      />
    </header>

    <Transition name="panel-rise">
      <p v-if="backupError" class="errors" role="alert">{{ backupError }}</p>
    </Transition>
    <Transition name="panel-rise">
      <div v-if="library.errors.length > 0" class="errors" role="alert">
        <p v-for="message in library.errors" :key="message">{{ message }}</p>
        <button type="button" @click="library.dismissErrors">
          {{ t('library.dismissErrors') }}
        </button>
      </div>
    </Transition>

    <Transition name="panel-rise">
      <div v-if="library.loaded && library.books.length === 0" class="empty">
        <p class="empty-line">{{ t('library.emptyLine') }}</p>
        <p class="empty-sub">{{ t('library.emptySub') }}</p>
      </div>
    </Transition>

    <!-- The book you left last, and everything else on the go beside it — one
         band, pushed sideways. -->
    <Transition name="panel-rise">
      <ReadingStrip v-if="library.reading.length > 0" :books="library.reading" />
    </Transition>

    <!-- A group rather than a plain list so a re-sort is something you can
         WATCH: each book keeps its identity and glides to its new place, which
         is the difference between "the shelf changed" and "these books moved". -->
    <TransitionGroup
      tag="div"
      name="shelf-card"
      class="shelf"
      :class="library.view"
      data-testid="shelf"
    >
      <BookCard
        v-for="book in library.sortedBooks"
        :key="book.id"
        :book="book"
        :view="library.view"
        @remove="onRemove"
        @toggle-finished="library.toggleFinished"
      />
    </TransitionGroup>
  </section>
</template>

<style scoped>
.library {
  max-width: 68rem;
  margin: 2.2rem auto 4rem;
  padding: 0 clamp(1rem, 3vw, 2rem);
}
.library-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  padding-bottom: 1.1rem;
  border-bottom: 1px solid var(--hair-soft);
}
.page-title {
  font-family: var(--font-display);
  font-weight: 500;
  font-size: 1.6rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  margin: 0;
}
.spend {
  margin: 0.35rem 0 0;
  font-family: var(--font-mono);
  font-size: 0.68rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.ledger {
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
  flex-wrap: wrap;
}
.ledger-dot {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  color: var(--text-faint);
}
/* A line of the same ledger, not a control that shouts: the type is the
   spend's own, and only the gold says it can be pressed. */
.balance {
  margin: 0.35rem 0 0;
  padding: 0;
  border: none;
  background: none;
  font-family: var(--font-mono);
  font-size: 0.68rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--gold);
  cursor: pointer;
}
.balance:hover:not(:disabled) {
  border: none;
  text-decoration: underline;
}
.balance:disabled {
  color: var(--text-faint);
  cursor: default;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.icon-btn {
  display: grid;
  place-items: center;
  width: 2.1rem;
  height: 2.1rem;
  padding: 0;
  border-radius: 50%;
  color: var(--text-dim);
}
.icon-btn:hover:not(:disabled),
.icon-btn[aria-expanded='true'] {
  color: var(--gold);
  border-color: var(--hair);
}
/* The one action a shelf with no books on it needs: gold, like the plate in
   the reader, and half again the size of its neighbours so the row has an
   obvious first move. */
.add-btn {
  width: 3rem;
  height: 3rem;
  color: var(--gold-ink);
  background: var(--gold);
  border-color: var(--gold);
  box-shadow: 0 6px 18px rgba(240, 174, 47, 0.18);
}
.add-icon {
  width: 24px;
  height: 24px;
  display: block;
}
.add-btn:hover:not(:disabled) {
  color: var(--gold-ink);
  background: var(--gold-mid);
  border-color: var(--gold-mid);
}
.add-btn:disabled {
  opacity: 0.6;
}
.morph-stack {
  position: relative;
  width: 18px;
  height: 18px;
  display: block;
}
.ctl-icon {
  position: absolute;
  inset: 0;
  width: 18px;
  height: 18px;
  display: block;
  transition:
    opacity 0.2s ease,
    transform 0.24s var(--ease-wipe);
}
.ctl-icon.off {
  opacity: 0;
  transform: rotate(-70deg) scale(0.7);
  pointer-events: none;
}
.ctl-icon-fixed {
  width: 18px;
  height: 18px;
  display: block;
}
.sort-wrap {
  position: relative;
}
.sort-menu {
  position: absolute;
  top: calc(100% + 0.45rem);
  inset-inline-end: 0;
  z-index: 30;
  min-width: 9.5rem;
  padding: 0.35rem;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  background: var(--bg-panel);
  border: 1px solid var(--hair);
  border-radius: 3px;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.4);
}
.sort-option {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  border: 0;
  background: transparent;
  text-align: start;
  padding: 0.45em 0.7em;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-dim);
}
.sort-option:hover {
  color: var(--gold);
  background: color-mix(in srgb, var(--gold) 8%, transparent);
}
.sort-option[aria-checked='true'] {
  color: var(--gold);
}
.sort-tick {
  width: 0.8em;
  font-size: 0.55rem;
  color: var(--gold);
}
.errors {
  border: 1px solid var(--danger);
  border-radius: 2px;
  color: var(--danger);
  padding: 0.5rem 1rem;
  margin: 1rem 0;
}
.shelf {
  display: grid;
  margin-top: 1.8rem;
  /* A card being removed leaves the flow (see .shelf-card-leave-active) and is
     positioned against this box while it goes. */
  position: relative;
}
/*
 * How many books to a row.
 *
 * Counted rather than fitted. `auto-fill` with a minimum track sounds like the
 * right tool and is the reason a phone was showing ONE cover the height of the
 * screen: a 11.5rem minimum simply does not fit twice into 358px, so the
 * shelf gave up and made one enormous column. A number of columns per
 * breakpoint is the promise actually being made — four on a phone, six on a
 * desk — and the covers take whatever width that leaves.
 *
 * The two views differ in the WRITING, not the size: covers alone pack tighter
 * than covers with a title, an author and a bar under them, so the view with
 * the words gets fewer to the row and more room between them.
 */
.shelf.compact {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.5rem 0.9rem;
}
@media (min-width: 560px) {
  .shelf.compact {
    grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
    gap: 1.8rem 1.5rem;
  }
}
/* Gallery mode: nothing but covers, so they sit closer together. */
.shelf.big {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.9rem 0.7rem;
}
@media (min-width: 560px) {
  .shelf.big {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 1.1rem 0.9rem;
  }
}
@media (min-width: 900px) {
  .shelf.big {
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 1.2rem 1.1rem;
  }
}
.empty {
  margin-top: 4rem;
  text-align: center;
}
.empty-line {
  font-family: var(--font-serif);
  font-size: 1.25rem;
  margin: 0 0 0.4rem;
}
.empty-sub {
  margin: 0;
  font-style: italic;
  color: var(--text-faint);
  font-size: 0.9rem;
}
</style>
