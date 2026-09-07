/**
 * What to say when the assistant cannot answer, and what to offer next.
 *
 * Bookworm has no server and no account: the reader's own NanoGPT key is what
 * makes the assistant work, and there are exactly four ways for that to be
 * wrong — no key, a key that is refused, an empty balance, and no network.
 * Each has a different fix, and only one of them is "try again", so a single
 * red line of text saying "the request failed" is the least useful thing the
 * app could do with what it already knows.
 *
 * So a failure is classified here into a KIND, and every kind carries the one
 * thing worth pressing: settings, or another go. Everything is pure — the
 * words are handed in, like the rest of the app's text, so translating means
 * writing sentences rather than rearranging logic.
 */

export type FailureKind =
  'no-key' | 'no-model' | 'bad-key' | 'no-balance' | 'offline' | 'busy' | 'server' | 'unknown'

/** The one thing worth pressing, if there is one. */
export type FailureAction = 'settings' | 'retry' | null

export interface Failure {
  kind: FailureKind
  /** What happened, in the reader's terms rather than the protocol's. */
  message: string
  action: FailureAction
  actionLabel: string | null
}

export interface FailureWords {
  message: string
  actionLabel: string | null
}

/**
 * The English text. `{status}` is replaced where a number genuinely helps
 * somebody report the problem.
 *
 * Two of these keep wording the smoke test looks for — "API key was rejected",
 * "Check your internet connection", "balance appears to be empty" — because
 * those phrases are what a reader searching the web for their problem will
 * have typed.
 */
export const ENGLISH_FAILURES: Record<FailureKind, FailureWords> = {
  'no-key': {
    message:
      'The assistant runs on your own NanoGPT key — Bookworm has no server and no account of its own. Add one and this book can talk.',
    actionLabel: 'Open settings',
  },
  'no-model': {
    message: 'Choose which model should answer, and the assistant is ready.',
    actionLabel: 'Open settings',
  },
  'bad-key': {
    message:
      'Your NanoGPT API key was rejected. It may have been revoked, or copied with a character missing.',
    actionLabel: 'Open settings',
  },
  'no-balance': {
    message:
      'Your NanoGPT balance appears to be empty. Top it up and the assistant carries on from here — nothing has been lost.',
    actionLabel: 'Open settings',
  },
  offline: {
    message:
      'Bookworm could not reach NanoGPT. Check your internet connection and try again — your books and everything you marked are on this device and need no connection at all.',
    actionLabel: 'Try again',
  },
  busy: {
    message: 'NanoGPT is asking for a moment’s pause. Wait a few seconds and try again.',
    actionLabel: 'Try again',
  },
  server: {
    message:
      'NanoGPT had trouble at its end (HTTP {status}). That is not something Bookworm can fix from here — it is usually over in a minute.',
    actionLabel: 'Try again',
  },
  unknown: {
    message:
      'The request failed{status}. Try it again; if it keeps happening, check your key and model in settings.',
    actionLabel: 'Try again',
  },
}

const ACTIONS: Record<FailureKind, FailureAction> = {
  'no-key': 'settings',
  'no-model': 'settings',
  'bad-key': 'settings',
  'no-balance': 'settings',
  offline: 'retry',
  busy: 'retry',
  server: 'retry',
  unknown: 'retry',
}

function build(
  kind: FailureKind,
  status: number | null,
  words: Record<FailureKind, FailureWords>,
): Failure {
  const entry = words[kind] ?? ENGLISH_FAILURES[kind]
  return {
    kind,
    // "(HTTP 503)" when there is a number, and nothing at all when there is
    // not — "The request failed (HTTP null)" helps nobody.
    message: entry.message
      .replace('{status}', status === null ? '' : String(status))
      .replace(' ()', '')
      .replace('()', ''),
    action: ACTIONS[kind],
    actionLabel: entry.actionLabel,
  }
}

/**
 * Is the assistant set up at all? Asked before anything is sent, because a
 * missing key is not a failed request — it is a question nobody asked yet.
 */
export function setupFailure(
  hasKey: boolean,
  hasModel: boolean,
  words: Record<FailureKind, FailureWords> = ENGLISH_FAILURES,
): Failure | null {
  if (!hasKey) return build('no-key', null, words)
  if (!hasModel) return build('no-model', null, words)
  return null
}

/**
 * Classify what came back.
 *
 * `online` is the browser's own opinion (`navigator.onLine`), and it is only
 * trusted when it says NO: a browser that thinks it is online can still be on
 * a café network that goes nowhere, but one that knows it is offline is right.
 */
export function describeFailure(
  status: number | null | undefined,
  online = true,
  words: Record<FailureKind, FailureWords> = ENGLISH_FAILURES,
): Failure {
  const code = typeof status === 'number' ? status : null
  if (code === null || !online) return build('offline', null, words)
  if (code === 401 || code === 403) return build('bad-key', code, words)
  if (code === 402) return build('no-balance', code, words)
  if (code === 429) return build('busy', code, words)
  if (code >= 500) return build('server', code, words)
  return build('unknown', code, words)
}
