<script setup lang="ts">
/**
 * One model picker, used in both places a model is chosen: the reader's
 * assistant and Settings. A native <select> of six hundred models is a wall —
 * this is a searchable, grouped list that shows what a model COSTS beside its
 * name, because on a pay-per-token account that is the fact the choice turns on.
 *
 * Filigrana, not a product dashboard: houses are named in small caps rather
 * than badged with logos, prices are set in the mono hand, and the only colour
 * is gold. Favourites are marked with a star, which needs no explaining.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  buildModelGroups,
  formatContext,
  formatModelPrice,
  houseCounts,
  MODEL_SORTS,
  type ModelSort,
  type PickerModel,
} from '@/lib/modelIndex'
import { dropFrom, shiftIntoView } from '@/lib/popover'
import type { Failure } from '@/lib/failure'
import AssistantTrouble from '@/components/chat/AssistantTrouble.vue'
import IconClose from '@/components/icons/IconClose.vue'
import IconSearch from '@/components/icons/IconSearch.vue'
import IconStar from '@/components/icons/IconStar.vue'
import { useI18n } from '@/i18n'

const { t } = useI18n()

const props = defineProps<{
  /** Currently chosen id; '' means the fallback option, when one is offered. */
  modelValue: string
  models: readonly PickerModel[]
  favouriteIds: readonly string[]
  loading?: boolean
  failure?: Failure | null
  /** Offered as the first row — the per-book picker's "use the default". */
  fallbackLabel?: string
  /** What that fallback resolves to, shown under it. */
  fallbackDetail?: string
  /** Small trigger for a toolbar; large for a settings page. */
  size?: 'small' | 'large'
  label?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [id: string]
  toggleFavourite: [id: string]
  /** The list would not load; the reader asked for another go. */
  reload: []
}>()

const open = ref(false)
const query = ref('')
const sort = ref<ModelSort>('house')
const houses = ref<string[]>([])
const active = ref(0)
const rootRef = ref<HTMLDivElement | null>(null)
const searchRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLDivElement | null>(null)
const sheetRef = ref<HTMLDivElement | null>(null)

const chosen = computed(() => props.models.find((model) => model.id === props.modelValue) ?? null)
const groups = computed(() =>
  buildModelGroups({
    models: props.models,
    query: query.value,
    sort: sort.value,
    favouriteIds: props.favouriteIds,
    houses: houses.value,
  }),
)
/** Flattened, so the keyboard can walk the list the eye sees. */
const flat = computed(() => groups.value.flatMap((group) => group.models))
const counts = computed(() => houseCounts(props.models))
const total = computed(() => flat.value.length)

/**
 * Which way the sheet opens, and how tall it may be. Measured, not assumed: in
 * the reader's toolbar there is no room below at all, and in Settings there is
 * room below until the Model section is scrolled near the foot of the window —
 * at which point a sheet that insists on opening downward is simply cut off.
 */
const drop = ref<{ up: boolean; max: number }>({ up: false, max: 480 })
/**
 * How far the sheet slides sideways to stay on screen. The sheet is aligned to
 * its TRIGGER, which knows nothing about the edges of the window — on a phone a
 * right-aligned sheet hangs off the left and takes the model names with it.
 */
const shift = ref(0)
/** The app's fixed nav owns the top of the window; a sheet must clear it. */
const TOP_INSET = 88

function measure(): void {
  const rect = rootRef.value?.getBoundingClientRect()
  if (!rect) return
  const room = dropFrom(rect, window.innerHeight, {
    topInset: TOP_INSET,
    bottomMargin: 16,
    wanted: 480,
  })
  drop.value = { up: room.up, max: room.maxHeight }
  // The sideways fit needs the sheet's real width, so it is measured once the
  // sheet has actually rendered — with shift still at zero, so what comes back
  // is where it would land unaided.
  shift.value = 0
  void nextTick(() => {
    const box = sheetRef.value?.getBoundingClientRect()
    if (box) shift.value = shiftIntoView(box, window.innerWidth)
  })
}

function openPanel(): void {
  open.value = true
  active.value = 0
  measure()
  void nextTick(() => searchRef.value?.focus())
}

function close(): void {
  open.value = false
  query.value = ''
}

function choose(id: string): void {
  emit('update:modelValue', id)
  close()
}

function toggleHouse(house: string): void {
  houses.value = houses.value.includes(house)
    ? houses.value.filter((entry) => entry !== house)
    : [...houses.value, house]
  active.value = 0
}

/** Arrows walk, Enter takes, Escape leaves — the list is usable without a mouse. */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key === 'Enter') {
    const model = flat.value[active.value]
    if (model) {
      event.preventDefault()
      choose(model.id)
    }
    return
  }
  const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
  if (step === 0) return
  event.preventDefault()
  const count = flat.value.length
  if (count === 0) return
  active.value = (active.value + step + count) % count
  void nextTick(() => {
    listRef.value?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  })
}

watch(query, () => {
  active.value = 0
})

function onDocumentPointer(event: PointerEvent): void {
  if (!open.value) return
  if (!rootRef.value?.contains(event.target as Node)) close()
}
document.addEventListener('pointerdown', onDocumentPointer)
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointer))
</script>

<template>
  <div ref="rootRef" class="picker" :class="size ?? 'small'" data-testid="model-picker">
    <button
      type="button"
      class="trigger"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :aria-label="label ?? t('model.choose')"
      data-testid="model-trigger"
      @click="open ? close() : openPanel()"
    >
      <span class="face">
        <span class="face-name">{{
          chosen?.name ??
          (modelValue.length === 0 ? (fallbackLabel ?? t('model.choose')) : modelValue)
        }}</span>
        <span v-if="chosen" class="face-price">{{ formatModelPrice(chosen) }}</span>
        <span v-else-if="fallbackDetail && modelValue.length === 0" class="face-price">{{
          fallbackDetail
        }}</span>
      </span>
      <i class="caret" aria-hidden="true"></i>
    </button>

    <Transition name="pop-fade">
      <div
        v-if="open"
        ref="sheetRef"
        class="sheet"
        :class="{ up: drop.up }"
        :style="{ maxHeight: `${drop.max}px`, transform: `translateX(${shift}px)` }"
        role="listbox"
        :aria-label="label ?? t('model.list')"
        @keydown="onKeydown"
      >
        <div class="sheet-head">
          <span class="search">
            <IconSearch class="search-mark" aria-hidden="true" />
            <input
              ref="searchRef"
              v-model="query"
              type="search"
              :placeholder="t('model.searchPlaceholder')"
              :aria-label="t('model.search')"
              data-testid="model-search"
            />
          </span>
          <button
            type="button"
            class="x-btn"
            :aria-label="t('model.close')"
            :title="t('overlay.close')"
            data-testid="model-close"
            @click="close"
          >
            <IconClose class="x-icon" aria-hidden="true" />
          </button>
        </div>

        <!-- How the list is ordered, and which houses it shows. -->
        <div class="sift">
          <div class="sorts" role="group" aria-label="Order">
            <button
              v-for="option in MODEL_SORTS"
              :key="option.id"
              type="button"
              class="chip"
              :class="{ on: sort === option.id }"
              :aria-pressed="sort === option.id"
              :data-testid="`model-sort-${option.id}`"
              @click="sort = option.id"
            >
              {{ option.label }}
            </button>
          </div>
          <div class="sorts houses" role="group" aria-label="Houses">
            <button
              v-for="entry in counts"
              :key="entry.house"
              type="button"
              class="chip"
              :class="{ on: houses.includes(entry.house) }"
              :aria-pressed="houses.includes(entry.house)"
              @click="toggleHouse(entry.house)"
            >
              {{ entry.house }} <i>{{ entry.count }}</i>
            </button>
          </div>
        </div>

        <p v-if="loading" class="note">Fetching the model list…</p>
        <AssistantTrouble
          v-else-if="failure"
          :failure="failure"
          class="note"
          @retry="emit('reload')"
        />

        <div ref="listRef" class="list">
          <!-- The fallback ("use the default") is a choice like any other. -->
          <!-- Same shape as a model row — a block-level <button> shrink-wraps its
             own contents in Chromium, so the row must be the div, as below. -->
          <div v-if="fallbackLabel" class="row" :class="{ picked: modelValue.length === 0 }">
            <button type="button" class="row-pick" data-testid="model-fallback" @click="choose('')">
              <span class="row-body">
                <span class="row-name">{{ fallbackLabel }}</span>
                <span v-if="fallbackDetail" class="row-id">{{ fallbackDetail }}</span>
              </span>
            </button>
            <i v-if="modelValue.length === 0" class="tick" aria-hidden="true"></i>
          </div>

          <template v-for="group in groups" :key="group.house">
            <p class="house">
              <span>{{ group.house }}</span>
              <i>{{ group.models.length }}</i>
            </p>
            <div
              v-for="model in group.models"
              :key="`${group.house}:${model.id}`"
              class="row"
              :class="{ picked: model.id === modelValue }"
              :data-active="flat[active]?.id === model.id"
              :data-model-id="model.id"
            >
              <button type="button" class="row-pick" @click="choose(model.id)">
                <span class="row-body">
                  <span class="row-name">{{ model.name }}</span>
                  <span class="row-id">{{ model.id }}</span>
                </span>
                <span class="row-facts">
                  <span class="row-price">{{ formatModelPrice(model) }}</span>
                  <span v-if="formatContext(model)" class="row-ctx">{{
                    formatContext(model)
                  }}</span>
                </span>
              </button>
              <button
                type="button"
                class="fav"
                :class="{ on: favouriteIds.includes(model.id) }"
                :aria-pressed="favouriteIds.includes(model.id)"
                :aria-label="
                  favouriteIds.includes(model.id)
                    ? `Remove ${model.name} from favourites`
                    : `Add ${model.name} to favourites`
                "
                :title="
                  favouriteIds.includes(model.id) ? t('model.favourite') : t('model.addFavourite')
                "
                data-testid="model-favourite"
                @click.stop="emit('toggleFavourite', model.id)"
              >
                <IconStar
                  class="star-mark"
                  :filled="favouriteIds.includes(model.id)"
                  aria-hidden="true"
                />
              </button>
              <i v-if="model.id === modelValue" class="tick" aria-hidden="true"></i>
            </div>
          </template>

          <p v-if="total === 0 && !loading" class="note" data-testid="model-empty">
            Nothing matches “{{ query }}”.
          </p>
        </div>

        <p class="foot">
          <span data-testid="model-count">{{ total }} of {{ models.length }}</span>
          <span class="foot-hint">prices per million tokens</span>
        </p>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.picker {
  position: relative;
  min-width: 0;
}

/* ————— the trigger ————— */
.trigger {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  min-width: 0;
  text-align: start;
  text-transform: none;
  letter-spacing: normal;
  font-family: var(--font-body, 'EB Garamond', Georgia, serif);
}
.small .trigger {
  padding: 0.35em 0.7em;
  font-size: 0.82rem;
  max-width: 15rem;
}
.large .trigger {
  padding: 0.6em 0.9em;
  font-size: 0.95rem;
}
.face {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
}
.face-name {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.face-price {
  font-family: var(--font-mono);
  font-size: 0.55rem;
  letter-spacing: 0.08em;
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.caret {
  flex-shrink: 0;
  width: 0;
  height: 0;
  border-left: 3.5px solid transparent;
  border-right: 3.5px solid transparent;
  border-top: 4px solid currentColor;
  opacity: 0.7;
}

/* ————— the sheet ————— */
.sheet {
  position: absolute;
  z-index: 60;
  top: calc(100% + 0.45rem);
  width: min(30rem, calc(100vw - 2rem));
  display: flex;
  flex-direction: column;
  border: 1px solid var(--hair-soft);
  border-radius: 3px;
  background: var(--bg-panel);
  box-shadow: var(--shadow);
}
/* Whichever way it opens, the sheet hangs from the edge of the trigger it
   belongs to — and the height is set inline from the room actually measured. */
.sheet.up {
  top: auto;
  bottom: calc(100% + 0.45rem);
}
/* A toolbar trigger sits at the right of its row; a settings one at the left. */
.small .sheet {
  right: 0;
}
.large .sheet {
  left: 0;
  width: min(34rem, calc(100vw - 2rem));
}
.sheet-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.7rem 0.5rem;
  border-bottom: 1px solid var(--hair-soft);
}
.search {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
}
.search-mark {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--text-faint);
}
.search input {
  flex: 1;
  min-width: 0;
  border: none;
  background: none;
  padding: 0.2em 0;
  font-size: 0.9rem;
}
.search input:focus-visible {
  outline: none;
}
.x-btn {
  display: grid;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  border-color: transparent;
  border-radius: 50%;
  color: var(--text-faint);
}
.x-btn:hover {
  color: var(--gold);
  border-color: var(--hair-soft);
}
.x-icon {
  width: 11px;
  height: 11px;
  display: block;
}

/* ————— sorting and houses ————— */
.sift {
  padding: 0.5rem 0.7rem;
  border-bottom: 1px solid var(--hair-soft);
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.sorts {
  display: flex;
  gap: 0.3rem;
  flex-wrap: wrap;
}
.chip {
  padding: 0.35em 0.65em;
  font-size: 0.53rem;
  color: var(--text-faint);
  border-color: transparent;
}
.chip:hover:not(:disabled) {
  color: var(--gold);
  border-color: var(--hair-soft);
}
.chip.on {
  color: var(--gold);
  border-color: var(--hair);
}
.chip i {
  font-style: normal;
  opacity: 0.55;
  margin-inline-start: 0.25em;
}
.houses .chip {
  font-size: 0.5rem;
}

/* ————— the list ————— */
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.3rem 0.35rem 0.5rem;
}
.house {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
  margin: 0.5rem 0 0.2rem;
  padding: 0.25rem 0.4rem;
  background: var(--bg-panel);
  font-family: var(--font-mono);
  font-size: 0.53rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--gold-deep);
}
.house i {
  font-style: normal;
  color: var(--text-faint);
  opacity: 0.7;
}
.row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  border-radius: 2px;
  padding-inline-end: 1.1rem;
}
.row:hover,
.row[data-active='true'] {
  background: var(--bg-raise);
}
.row.picked {
  background: rgba(209, 146, 30, 0.07);
}
.row-pick {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  /* Buttons are centred everywhere else in this app; a list row is not. */
  justify-content: flex-start;
  gap: 0.7rem;
  padding: 0.4rem 0.45rem;
  border: none;
  background: none;
  text-align: start;
  text-transform: none;
  letter-spacing: normal;
  font-family: var(--font-body, 'EB Garamond', Georgia, serif);
  font-size: 0.88rem;
}
.row-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
}
.row-name {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-id {
  font-family: var(--font-mono);
  font-size: 0.54rem;
  letter-spacing: 0.04em;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-facts {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.05rem;
  font-family: var(--font-mono);
  font-size: 0.54rem;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.row-price {
  color: var(--gold-mid);
}
.row-ctx {
  color: var(--text-faint);
  opacity: 0.8;
}
/* Pinning: a star — the one mark for this that nobody has to be taught. */
.fav {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  border-color: transparent;
  border-radius: 50%;
  color: var(--text-faint);
  opacity: 0;
  transition: opacity 0.15s ease;
}
.row:hover .fav,
.row:focus-within .fav,
.fav.on {
  opacity: 1;
}
.fav.on {
  color: var(--gold);
}
.fav:hover {
  color: var(--gold);
  border-color: var(--hair-soft);
}
.star-mark {
  width: 12px;
  height: 12px;
  display: block;
}
.tick {
  position: absolute;
  inset-inline-end: 0.35rem;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--gold);
}

.note {
  margin: 0.6rem 0.5rem;
  color: var(--text-faint);
  font-size: 0.85rem;
}
.foot {
  margin: 0;
  padding: 0.45rem 0.7rem;
  border-top: 1px solid var(--hair-soft);
  display: flex;
  justify-content: space-between;
  gap: 0.6rem;
  font-family: var(--font-mono);
  font-size: 0.52rem;
  letter-spacing: 0.12em;
  color: var(--text-faint);
}
.foot-hint {
  opacity: 0.75;
}
</style>
