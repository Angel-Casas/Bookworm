/** Timer-based debounce (side-effectful, hence in services). */

export interface Debounced<Args extends unknown[]> {
  (...args: Args): void
  /** Run any pending call immediately. */
  flush(): void
  cancel(): void
}

export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number,
): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingArgs: Args | null = null

  const invoke = (): void => {
    if (pendingArgs === null) return
    const args = pendingArgs
    pendingArgs = null
    fn(...args)
  }

  const debounced = (...args: Args): void => {
    pendingArgs = args
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      invoke()
    }, waitMs)
  }

  debounced.flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    invoke()
  }

  debounced.cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    pendingArgs = null
  }

  return debounced
}
