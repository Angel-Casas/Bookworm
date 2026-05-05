import type { NotebookEntry } from './types';

function entryHaystack(entry: NotebookEntry): string {
  const parts: string[] = [];
  if (entry.kind === 'bookmark') {
    if (entry.bookmark.snippet) parts.push(entry.bookmark.snippet);
    if (entry.bookmark.sectionTitle) parts.push(entry.bookmark.sectionTitle);
  } else if (entry.kind === 'highlight') {
    parts.push(entry.highlight.selectedText);
    if (entry.highlight.sectionTitle) parts.push(entry.highlight.sectionTitle);
    if (entry.note) parts.push(entry.note.content);
  } else {
    parts.push(entry.savedAnswer.question);
    parts.push(entry.savedAnswer.content);
    if (entry.savedAnswer.userNote) parts.push(entry.savedAnswer.userNote);
  }
  return parts.join('\n').toLowerCase();
}

export function matchesQuery(entry: NotebookEntry, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === '') return true;
  return entryHaystack(entry).includes(trimmed);
}
