import type { NotebookEntry } from './types';
import type { Bookmark, Highlight, Note } from '@/domain/annotations/types';
import type { SavedAnswer, ContextRef } from '@/domain';
import { relativeTime } from '@/shared/text/relativeTime';

export type ExportArgs = {
  readonly bookTitle: string;
  readonly entries: readonly NotebookEntry[];
  readonly nowMs?: number;
};

export function exportNotebookToMarkdown(args: ExportArgs): string {
  const { bookTitle, entries, nowMs = Date.now() } = args;
  const exportDate = new Date(nowMs).toISOString().slice(0, 10);
  const out: string[] = [
    `# ${bookTitle}`,
    '',
    `> Exported from Bookworm on ${exportDate}.`,
    '',
    '---',
    '',
  ];

  if (entries.length === 0) {
    out.push('*No entries to export.*');
    return out.join('\n');
  }

  const bookmarks = entries.filter(
    (e): e is Extract<NotebookEntry, { kind: 'bookmark' }> => e.kind === 'bookmark',
  );
  const highlights = entries.filter(
    (e): e is Extract<NotebookEntry, { kind: 'highlight' }> => e.kind === 'highlight',
  );
  const answers = entries.filter(
    (e): e is Extract<NotebookEntry, { kind: 'savedAnswer' }> => e.kind === 'savedAnswer',
  );

  if (bookmarks.length > 0) {
    out.push('## Bookmarks', '');
    for (const e of bookmarks) {
      for (const line of renderBookmark(e.bookmark, nowMs)) out.push(line);
    }
  }

  if (highlights.length > 0) {
    out.push('## Highlights', '');
    let lastSection: string | null = null;
    for (const e of highlights) {
      const section = e.highlight.sectionTitle ?? '(no section)';
      if (section !== lastSection) {
        out.push(`### ${section}`, '');
        lastSection = section;
      }
      for (const line of renderHighlight(e.highlight, e.note, nowMs)) out.push(line);
    }
  }

  if (answers.length > 0) {
    out.push('## Saved AI answers', '');
    for (const e of answers) {
      for (const line of renderAnswer(e.savedAnswer, nowMs)) out.push(line);
    }
  }

  return out.join('\n');
}

function renderBookmark(b: Bookmark, nowMs: number): string[] {
  const date = relativeTime(b.createdAt, nowMs);
  const snippet = b.snippet ?? '(no snippet)';
  const lines: string[] = [`- **${b.sectionTitle ?? '(no section)'}** — *${date}*`];
  for (const line of blockquoteLines(snippet, '  ')) lines.push(line);
  lines.push('');
  return lines;
}

function renderHighlight(h: Highlight, note: Note | null, nowMs: number): string[] {
  const date = relativeTime(h.createdAt, nowMs);
  const lines: string[] = [];
  for (const line of blockquoteLines(h.selectedText)) lines.push(line);
  lines.push('', `*${h.color}* · *${date}*`, '');
  if (note) {
    lines.push(`> **Note:** ${firstLine(note.content)}`);
    for (const extra of subsequentLines(note.content)) {
      lines.push(`> ${extra}`);
    }
    lines.push('');
  }
  return lines;
}

function renderAnswer(a: SavedAnswer, nowMs: number): string[] {
  const date = relativeTime(a.createdAt, nowMs);
  const lines: string[] = [
    `### ${oneLine(a.question)}`,
    '',
    `*${a.mode}* · *${a.modelId}* · *${date}*`,
    '',
  ];
  for (const line of blockquoteLines(a.content)) lines.push(line);
  lines.push('');
  if (a.contextRefs.length > 0) {
    lines.push('**Sources:**');
    for (const ref of a.contextRefs) {
      lines.push(`- ${refSourceLine(ref)}`);
    }
    lines.push('');
  }
  if (a.userNote !== undefined && a.userNote !== '') {
    lines.push(`> **Your note:** ${firstLine(a.userNote)}`);
    for (const extra of subsequentLines(a.userNote)) {
      lines.push(`> ${extra}`);
    }
    lines.push('');
  }
  return lines;
}

function refSourceLine(ref: ContextRef): string {
  switch (ref.kind) {
    case 'passage':
      return `${ref.sectionTitle ?? '(no section)'} — *passage*`;
    case 'section':
      return `${ref.sectionTitle ?? '(no section)'} — *section*`;
    case 'highlight':
      return `(highlight) — *highlight*`;
    case 'chunk':
      return `(chunk) — *chunk*`;
  }
}

function blockquoteLines(text: string, indent: string = ''): string[] {
  return text.split('\n').map((line) => `${indent}> ${line}`);
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function firstLine(text: string): string {
  const idx = text.indexOf('\n');
  return idx === -1 ? text : text.slice(0, idx);
}

function subsequentLines(text: string): string[] {
  const idx = text.indexOf('\n');
  if (idx === -1) return [];
  return text.slice(idx + 1).split('\n');
}

export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'notebook';
}
