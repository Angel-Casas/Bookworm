<script setup lang="ts">
/**
 * A sentence with one link in it, placed where the TRANSLATION puts it.
 *
 * The English way of writing this — text, `<a>`, more text — hard-codes the
 * word order of one language into the template, and there are languages where
 * the link belongs at the other end of the sentence. So the message keeps a
 * `{link}` of its own and this splits on it: the translator moves the link by
 * moving three characters, and the markup never changes.
 */
import { computed } from 'vue'

const props = defineProps<{ text: string; href: string; label: string }>()

const parts = computed(() => {
  const at = props.text.indexOf('{link}')
  // A translation that dropped the placeholder still reads as a sentence; the
  // link simply follows it rather than sitting inside it.
  if (at === -1) return [props.text, ' ']
  return [props.text.slice(0, at), props.text.slice(at + '{link}'.length)]
})
</script>

<template>
  <span
    >{{ parts[0] }}<a :href="href" target="_blank" rel="noopener">{{ label }}</a
    >{{ parts[1] }}</span
  >
</template>
