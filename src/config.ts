/** App-wide constants. */

/**
 * Where a reader is sent to make a NanoGPT account.
 *
 * It carries the project owner's invitation code, and a reader who arrives
 * through it pays 5% LESS on every model call, for as long as the account
 * lasts. NanoGPT returns a small share to the project, which is the only
 * income Bookworm has — there is no subscription, no account and nothing to
 * sell. The app says both halves of that plainly next to the link
 * (`settings.referral`) rather than passing a referral off as a plain URL.
 */
export const NANOGPT_SIGNUP_URL = 'https://nano-gpt.com/r/BnfJfghE'

/**
 * Where the key itself is made. No referral to carry — a reader is signed in
 * by the time they are here, and the page only exists once they are.
 */
export const NANOGPT_API_KEYS_URL = 'https://nano-gpt.com/api'

/** The repository. The support overlay opens issues at `<this>/issues/new`. */
export const GITHUB_REPO_URL = 'https://github.com/Angel-Casas/Bookworm'

export const NANOGPT_API_BASE = 'https://nano-gpt.com/api/v1'

/** Older account endpoints (e.g. check-balance) live outside /v1. */
export const NANOGPT_ACCOUNT_API_BASE = 'https://nano-gpt.com/api'

/** Tokens reserved for the model's answer + system prompt inside the context window. */
export const RESERVED_COMPLETION_TOKENS = 4000

/** Fallback context budget (tokens) when the selected model's window is unknown. */
export const DEFAULT_CONTEXT_TOKENS = 60000
