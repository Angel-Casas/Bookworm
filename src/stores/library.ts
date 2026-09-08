/** Orchestrates the book collection: IndexedDB persistence + UI state. */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import * as db from '@/services/db'
import {
  COVER_EXTRACT_VERSION,
  UnsupportedFileError,
  extractCover,
  importBookFile,
} from '@/services/bookImport'
import {
  DEFAULT_LIBRARY_SORT,
  bookToContinue,
  isLibrarySort,
  sortBooks,
  type LibrarySort,
} from '@/lib/librarySort'
import { translateIn } from '@/i18n'
import { useLanguageStore } from '@/stores/language'
import type { BookMeta } from '@/lib/types'

export type LibraryView = 'big' | 'compact'

/** Shelf presentation prefs — like the theme, these are UI state, not user data,
 *  so localStorage (not IndexedDB) is their home. */
const VIEW_KEY = 'bookworm.libraryView.v1'
const SORT_KEY = 'bookworm.librarySort.v1'

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage unavailable (private mode etc.) — the pref just won't persist.
  }
}

export const useLibraryStore = defineStore('library', () => {
  const books = ref<BookMeta[]>([])
  const loaded = ref(false)
  const importing = ref(false)
  const errors = ref<string[]>([])

  const storedView = readPref(VIEW_KEY)
  const view = ref<LibraryView>(storedView === 'compact' ? 'compact' : 'big')
  const storedSort = readPref(SORT_KEY)
  const sort = ref<LibrarySort>(isLibrarySort(storedSort) ? storedSort : DEFAULT_LIBRARY_SORT)

  const sortedBooks = computed(() => sortBooks(books.value, sort.value))

  /** The book the shelf offers to pick up again; null on a shelf never read. */
  const continuing = computed(() => bookToContinue(books.value))

  function toggleView(): void {
    view.value = view.value === 'big' ? 'compact' : 'big'
    writePref(VIEW_KEY, view.value)
  }

  /**
   * Set the view WITHOUT remembering it.
   *
   * The tour needs the compact shelf for the step that explains what is
   * written under a cover, and hands the reader's own setting back when it
   * ends. Borrowing a preference must not become choosing one, so this is the
   * one path to `view` that does not write to storage.
   */
  function previewView(value: LibraryView): void {
    view.value = value
  }

  function setSort(value: LibrarySort): void {
    sort.value = value
    writePref(SORT_KEY, value)
  }

  async function load(): Promise<void> {
    books.value = await db.listBooks()
    loaded.value = true
    void backfillCovers()
  }

  /**
   * Books imported before the cover fallback existed may have no cover even
   * though one is extractable. Try once per book, then mark it checked so
   * genuinely coverless books are not re-parsed on every load.
   */
  async function backfillCovers(): Promise<void> {
    for (const book of books.value) {
      if (book.coverBlob || book.coverChecked === COVER_EXTRACT_VERSION) continue
      try {
        const raw = await db.getBookFile(book.id)
        // Books restored from old backups may hold a bare ArrayBuffer.
        const file =
          raw instanceof Blob ? raw : raw ? new Blob([raw as unknown as ArrayBuffer]) : null
        if (!file) {
          console.warn('[bookworm] cover backfill: no stored file for', book.title)
        }
        const cover = file ? await extractCover(file, book.format) : null
        if (!cover && book.format === 'pdf') {
          console.warn('[bookworm] cover backfill: pdf render yielded no cover for', book.title)
        }
        const updated: BookMeta = {
          ...book,
          coverBlob: cover,
          coverChecked: COVER_EXTRACT_VERSION,
        }
        await db.updateBookMeta(updated)
        books.value = books.value.map((candidate) =>
          candidate.id === book.id ? updated : candidate,
        )
      } catch (error) {
        // Loud, not silent (see LESSONS): the book stays unmarked so the next
        // load retries it.
        console.warn('[bookworm] cover backfill failed for', book.title, error)
      }
    }
  }

  async function importFiles(files: Iterable<File>): Promise<void> {
    importing.value = true
    errors.value = []
    try {
      for (const file of files) {
        try {
          const { meta, blob } = await importBookFile(file)
          await db.saveBook(meta, blob)
          books.value.push(meta)
        } catch (error) {
          // The reader is told which file and what kind of problem, in their
          // own language — not handed the Error's own English message.
          const code = useLanguageStore().code
          errors.value.push(
            translateIn(
              code,
              error instanceof UnsupportedFileError ? 'library.unsupported' : 'library.cannotRead',
              { file: file.name },
            ),
          )
        }
      }
    } finally {
      importing.value = false
    }
  }

  async function removeBook(id: string): Promise<void> {
    await db.deleteBook(id)
    books.value = books.value.filter((book) => book.id !== id)
  }

  /**
   * Merge a change into one book's metadata, in the store AND on disk.
   *
   * Everything that writes to a book goes through here, because two writers
   * holding their own copy of the same record will eventually save one on top
   * of the other — the reader saving a position over the "last opened" stamp
   * the shelf had just written, for instance. Falls back to the stored record
   * when the shelf has not been loaded (a link straight into the reader).
   */
  async function patchBook(id: string, patch: Partial<BookMeta>): Promise<BookMeta | null> {
    const known = books.value.find((candidate) => candidate.id === id)
    const current = known ?? (await db.getBookMeta(id)) ?? null
    if (!current) return null
    const updated: BookMeta = { ...current, ...patch }
    await db.updateBookMeta(updated)
    books.value = books.value.map((candidate) => (candidate.id === id ? updated : candidate))
    return updated
  }

  async function markOpened(id: string): Promise<BookMeta | null> {
    return patchBook(id, { lastOpenedAt: Date.now() })
  }

  /** Where the reader left off, and how far in that is (0–1, null if unknown). */
  async function saveReadingState(
    id: string,
    position: string | null,
    progress: number | null,
  ): Promise<BookMeta | null> {
    return patchBook(id, { position, progress })
  }

  /** Flip a book between finished and unfinished. */
  async function toggleFinished(id: string): Promise<void> {
    const book = books.value.find((candidate) => candidate.id === id)
    if (!book) return
    await patchBook(id, { finishedAt: book.finishedAt != null ? null : Date.now() })
  }

  function dismissErrors(): void {
    errors.value = []
  }

  return {
    books,
    sortedBooks,
    continuing,
    loaded,
    importing,
    errors,
    view,
    sort,
    toggleView,
    previewView,
    setSort,
    load,
    importFiles,
    removeBook,
    patchBook,
    markOpened,
    saveReadingState,
    toggleFinished,
    dismissErrors,
  }
})
