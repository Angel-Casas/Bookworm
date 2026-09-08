<script setup lang="ts">
/**
 * One of the app's own buttons, drawn inside a line of the tour card.
 *
 * The tour's job is to connect a sentence to a shape on screen, and the
 * shortest way to say "the ranked bars" is to draw the ranked bars. Every
 * glyph here is the SAME component the button uses — not a copy of it — so a
 * redrawn icon cannot leave the tour pointing at something the app no longer
 * has.
 *
 * `src/lib/tour.ts` names them; this is the only place that knows which
 * component and which props each name means.
 */
import type { TourGlyph } from '@/lib/tour'
import IconPlus from '@/components/icons/IconPlus.vue'
import IconGrid from '@/components/icons/IconGrid.vue'
import IconSearch from '@/components/icons/IconSearch.vue'
import IconRank from '@/components/icons/IconRank.vue'
import IconArchive from '@/components/icons/IconArchive.vue'
import IconSupport from '@/components/icons/IconSupport.vue'
import IconLang from '@/components/icons/IconLang.vue'
import IconTheme from '@/components/icons/IconTheme.vue'
import IconSettings from '@/components/icons/IconSettings.vue'
import IconSpread from '@/components/icons/IconSpread.vue'
import IconType from '@/components/icons/IconType.vue'
import IconFocus from '@/components/icons/IconFocus.vue'
import IconDaylight from '@/components/icons/IconDaylight.vue'
import IconInkwell from '@/components/icons/IconInkwell.vue'
import IconRibbon from '@/components/icons/IconRibbon.vue'
import IconLamp from '@/components/icons/IconLamp.vue'
import IconGloss from '@/components/icons/IconGloss.vue'

defineProps<{ glyph: TourGlyph }>()
</script>

<template>
  <span class="glyph" :class="{ tall: glyph === 'lamp' }" aria-hidden="true">
    <IconPlus v-if="glyph === 'plus'" />
    <IconGrid v-else-if="glyph === 'grid-big'" :cells="2" />
    <IconGrid v-else-if="glyph === 'grid-compact'" :cells="3" />
    <IconSearch v-else-if="glyph === 'search'" />
    <IconRank v-else-if="glyph === 'rank'" />
    <IconArchive v-else-if="glyph === 'archive-out'" dir="out" />
    <IconArchive v-else-if="glyph === 'archive-in'" dir="in" />
    <IconSupport v-else-if="glyph === 'support'" />
    <IconLang v-else-if="glyph === 'lang'" />
    <IconTheme v-else-if="glyph === 'theme-dark'" mode="dark" />
    <IconTheme v-else-if="glyph === 'theme-light'" mode="light" />
    <IconSettings v-else-if="glyph === 'settings'" />
    <IconSpread v-else-if="glyph === 'spread-single'" mode="single" />
    <IconSpread v-else-if="glyph === 'spread-double'" mode="double" />
    <IconSpread v-else-if="glyph === 'spread-scroll'" mode="scroll" />
    <IconType v-else-if="glyph === 'type'" />
    <IconFocus v-else-if="glyph === 'focus'" />
    <IconDaylight v-else-if="glyph === 'daylight-light'" mode="light" />
    <IconDaylight v-else-if="glyph === 'daylight-dark'" mode="dark" />
    <IconInkwell v-else-if="glyph === 'inkwell'" full />
    <IconRibbon v-else-if="glyph === 'ribbon'" />
    <IconLamp v-else-if="glyph === 'lamp'" lit />
    <IconGloss v-else-if="glyph === 'gloss'" />
    <!-- Contents has no icon of its own in the reader: the control is a word.
         Three ruled lines stand for it, in the same weight as its neighbours. -->
    <svg v-else-if="glyph === 'contents'" viewBox="0 0 24 24" fill="none">
      <g stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <path d="M5 7h14M5 12h14M5 17h9" />
      </g>
    </svg>
  </span>
</template>

<style scoped>
/*
 * Sized in `em`, not px: the glyph belongs to the line it sits in, and a card
 * whose text the reader has scaled up gets icons that grow with it.
 */
.glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.15em;
  height: 1.15em;
  flex: none;
  color: var(--gold);
  vertical-align: -0.22em;
}
.glyph :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
/* The lamp is drawn on a taller viewBox than the 24-square icons, so on a
   shared square it reads as smaller than everything beside it. It is given
   the shape it was drawn for instead. */
.glyph.tall {
  width: 1.2em;
  height: 1.45em;
  vertical-align: -0.35em;
}
</style>
