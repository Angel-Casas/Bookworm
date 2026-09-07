<script setup lang="ts">
defineProps<{ lit?: boolean }>()
</script>

<template>
  <!-- The reading-lamp charm from the landing page, wired to actually light. -->
  <svg viewBox="0 0 40 48" fill="none" aria-hidden="true" class="lamp" :class="{ lit }">
    <g
      class="ring"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx="20" cy="5" r="2.8" />
      <path d="M20 7.8v4.7" />
      <circle cx="20" cy="28" r="15.5" />
    </g>
    <ellipse class="halo" cx="20" cy="27" rx="9.5" ry="8.5" />
    <g
      class="body"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M14.5 26h11l-2.6-6.5h-5.8z M20 26v5.5M16 33.5h8" />
    </g>
    <circle class="flame" cx="20" cy="23" r="1.7" />
  </svg>
</template>

<style scoped>
.lamp .halo {
  fill: var(--gold);
  opacity: 0;
  transition: opacity 0.45s ease;
}
.lamp .flame {
  fill: var(--gold);
  opacity: 0;
  transform-origin: 20px 23px;
  transition: opacity 0.3s ease;
}
.lamp.lit .halo {
  opacity: 0.16;
}
.lamp.lit .flame {
  opacity: 1;
  animation: flicker 2.6s ease-in-out infinite;
}
@keyframes flicker {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  42% {
    opacity: 0.82;
    transform: scale(0.9);
  }
  70% {
    opacity: 0.95;
    transform: scale(1.05);
  }
}
</style>
