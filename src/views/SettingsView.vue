<script setup lang="ts">
/**
 * Settings lives in the nav's overlay now. This route survives as a
 * deep-link: it opens the overlay over the library and steps aside.
 */
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUiStore } from '@/stores/ui'

const router = useRouter()
const ui = useUiStore()

onMounted(() => {
  ui.overlay = 'settings'
  void router.replace({ name: 'library' })
})
</script>

<template>
  <div aria-hidden="true"></div>
</template>
