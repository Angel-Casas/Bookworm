<script setup lang="ts">
/** A star, drawn by hand rather than struck from a stencil — the points are
 *  a little uneven, the way a pen makes them. Outlined when the model is
 *  merely listed, filled in gold once it has been pinned. */
withDefaults(defineProps<{ filled?: boolean }>(), { filled: false })
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      class="star"
      :class="{ filled }"
      d="M12 3.2 14.7 9.1 21.1 9.9 16.4 14.3 17.7 20.6 12 17.5 6.3 20.6 7.6 14.3 2.9 9.9 9.3 9.1Z"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>

<style scoped>
.star {
  fill: none;
  transition: fill 0.18s ease;
}
.star.filled {
  fill: currentColor;
}
</style>
