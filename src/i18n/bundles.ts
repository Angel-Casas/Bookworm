/**
 * The word-bundles the pure layer asks for.
 *
 * Several functions in `src/lib` were written to take their vocabulary from
 * outside — `formatDuration` takes its units, `buildMarksMarkdown` its
 * headings, `describeFailure` its sentences — precisely so that translating
 * them would be a matter of handing in different words rather than rewriting
 * the logic. This file is where those words are collected from the catalogue.
 *
 * It sits between the catalogue and the pure functions so that neither has to
 * know about the other: `src/lib` stays free of i18n, and the catalogue stays
 * a flat list of strings.
 */
import type { DurationWords } from '@/lib/format'
import type { FailureKind, FailureWords } from '@/lib/failure'
import type { MarksWords } from '@/lib/marksExport'
import { translateIn } from '@/i18n'

/** Units for "3h 12m". */
export function durationWordsIn(code: string): DurationWords {
  return {
    hour: translateIn(code, 'time.hour'),
    minute: translateIn(code, 'time.minute'),
    underAMinute: translateIn(code, 'time.underAMinute'),
    unknown: translateIn(code, 'time.unknown'),
  }
}

const FAILURE_KINDS: readonly FailureKind[] = [
  'no-key',
  'no-model',
  'bad-key',
  'no-balance',
  'offline',
  'busy',
  'server',
  'unknown',
]

/** What the assistant says when it cannot answer, and what the button says. */
export function failureWordsIn(code: string): Record<FailureKind, FailureWords> {
  const words = {} as Record<FailureKind, FailureWords>
  for (const kind of FAILURE_KINDS) {
    words[kind] = {
      message: translateIn(code, `failure.${kind}` as never),
      actionLabel: translateIn(code, `failure.${kind}.action` as never),
    }
  }
  return words
}

/** The headings inside an exported marks file. */
export function marksWordsIn(code: string): MarksWords {
  return {
    bookmark: translateIn(code, 'marks.bookmark'),
    highlight: translateIn(code, 'marks.highlight'),
    note: translateIn(code, 'marks.note'),
    marks: {
      one: translateIn(code, 'marks.countOne'),
      other: translateIn(code, 'marks.countOther'),
    },
    savedOn: translateIn(code, 'marks.savedOn'),
    page: translateIn(code, 'marks.page'),
    nothing: translateIn(code, 'marks.nothing'),
  }
}
