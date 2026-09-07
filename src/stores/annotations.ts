/** Bookmarks and highlights per book, persisted in IndexedDB. */
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { generateId } from '@/lib/id'
import { addAnnotation, deleteAnnotation, listAnnotationsForBook } from '@/services/db'
import type { Annotation, AnnotationType } from '@/lib/types'

export const useAnnotationsStore = defineStore('annotations', () => {
  const byBook = ref<Record<string, Annotation[]>>({})
  /** The last annotation the reader deleted — lets the UI tell a removal
   *  apart from a mark simply falling off the visible page. */
  const lastRemovedId = ref<string | null>(null)
  const loadedBooks = new Set<string>()

  function annotationsFor(bookId: string): Annotation[] {
    return byBook.value[bookId] ?? []
  }

  async function load(bookId: string): Promise<void> {
    if (loadedBooks.has(bookId)) return
    loadedBooks.add(bookId)
    const annotations = await listAnnotationsForBook(bookId).catch(() => [])
    byBook.value = {
      ...byBook.value,
      [bookId]: annotations.sort((a, b) => a.createdAt - b.createdAt),
    }
  }

  async function add(
    bookId: string,
    type: AnnotationType,
    position: string,
    label: string,
    text: string | null,
    color: string | null = null,
  ): Promise<void> {
    // One bookmark per position: adding where one exists is a no-op (the UI
    // offers a toggle instead).
    if (type === 'bookmark' && findBookmark(bookId, position)) return
    const annotation: Annotation = {
      id: generateId(),
      bookId,
      type,
      position,
      label,
      text,
      color,
      createdAt: Date.now(),
    }
    await addAnnotation(annotation)
    byBook.value = { ...byBook.value, [bookId]: [...annotationsFor(bookId), annotation] }
  }

  function findBookmark(bookId: string, position: string): Annotation | null {
    return (
      annotationsFor(bookId).find(
        (annotation) => annotation.type === 'bookmark' && annotation.position === position,
      ) ?? null
    )
  }

  /** Change a saved highlight's wash color in place. */
  async function recolor(bookId: string, id: string, color: string): Promise<void> {
    const target = annotationsFor(bookId).find((annotation) => annotation.id === id)
    if (!target || target.color === color) return
    const updated: Annotation = { ...target, color }
    // addAnnotation is an IndexedDB put: same key overwrites.
    await addAnnotation(updated)
    byBook.value = {
      ...byBook.value,
      [bookId]: annotationsFor(bookId).map((annotation) =>
        annotation.id === id ? updated : annotation,
      ),
    }
  }

  async function remove(bookId: string, id: string): Promise<void> {
    await deleteAnnotation(id)
    // Set BEFORE the list changes: watchers on "is there a mark here?" fire
    // the moment it does, and they need to know whether the mark went away
    // because the reader took it off or because the page moved on.
    lastRemovedId.value = id
    byBook.value = {
      ...byBook.value,
      [bookId]: annotationsFor(bookId).filter((annotation) => annotation.id !== id),
    }
  }

  return { byBook, lastRemovedId, annotationsFor, findBookmark, load, add, recolor, remove }
})
